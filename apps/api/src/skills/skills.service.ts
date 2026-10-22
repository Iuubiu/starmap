import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import {
  SkillListResponseSchema,
  SkillDetailResponseSchema,
  SkillSystemPreviewResponseSchema,
  type SkillListResponse,
  type SkillDetailResponse,
  type SkillSystemPreviewResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';
import {
  defaultSkillsDir,
  scanSkills,
  type ScannedSkill,
  type ScanResult,
} from './skill-scanner.js';
import { composeSkillSystemMessage } from '../mastra/skills/system-message.js';
import { BASE_AGENT_PROMPT } from '../mastra/skills/base-prompt.js';

/**
 * skill 库的组装层：文件系统 + 数据库开关 = 页面看到的那个列表。
 *
 * ## 两个数据源各管一半
 *
 * - **存在性、正文、版本、触发场景**：只来自文件系统。数据库里没有它们的
 *   副本，所以不可能出现「库里有、文件没了」的半状态。
 * - **启用状态**：只来自 `app.skill_switches`，规则是「没有行 = 启用」。
 *   因此新增一个 skill 目录立刻可用，不需要先插一行。
 *
 * 不缓存：扫描 8 个目录是毫秒级的事，而缓存会让「改了 SKILL.md 刷新看不到」
 * 变成一个新 bug。真正需要缓存的检索索引另有其缓存（见 RetrievalService）。
 */
@Injectable()
export class SkillsService {
  private readonly logger = new Logger('Skills');

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** 扫描目录（可被测试用量覆盖）。 */
  private scan(): ScanResult {
    return scanSkills(defaultSkillsDir());
  }

  /** 读开关表。没有行的 skill 视为启用。 */
  private async readSwitches(): Promise<Map<string, boolean>> {
    const rows = await this.db.query<{ name: string; enabled: boolean }>(
      'SELECT name, enabled FROM skill_switches',
    );
    return new Map(rows.map((row) => [row.name, row.enabled]));
  }

  /** `enabled` 的权威判定：表里有行就看行，没行就是启用。 */
  private isEnabled(name: string, switches: Map<string, boolean>): boolean {
    return switches.get(name) ?? true;
  }

  async list(): Promise<SkillListResponse> {
    const scan = this.scan();
    const switches = await this.readSwitches();

    const items = scan.skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      version: skill.version,
      triggerScenarios: skill.triggerScenarios,
      enabled: this.isEnabled(skill.name, switches),
      referenceCount: skill.references.length,
      directoryName: skill.directoryName,
    }));

    const enabledCount = items.filter((item) => item.enabled).length;

    return SkillListResponseSchema.parse({
      directory: scan.directory,
      items,
      enabledCount,
      disabledCount: items.length - enabledCount,
    });
  }

  /** 按名找 skill。找不到抛 404（控制器负责翻译成 HTTP 语义）。 */
  private findByName(scan: ScanResult, name: string): ScannedSkill {
    const skill = scan.skills.find((s) => s.name === name) ?? scan.skills.find((s) => s.directoryName === name);
    if (!skill) throw new NotFoundException({ code: 'NOT_FOUND', message: `skill 不存在: ${name}` });
    return skill;
  }

  async detail(name: string): Promise<SkillDetailResponse> {
    const scan = this.scan();
    const skill = this.findByName(scan, name);
    const switches = await this.readSwitches();

    return SkillDetailResponseSchema.parse({
      skill: {
        name: skill.name,
        description: skill.description,
        version: skill.version,
        triggerScenarios: skill.triggerScenarios,
        enabled: this.isEnabled(skill.name, switches),
        referenceCount: skill.references.length,
        directoryName: skill.directoryName,
        instructions: skill.instructions,
        references: skill.references,
        validation: skill.validation,
      },
    });
  }

  /**
   * 写开关。
   *
   * 用 upsert 而不是先查后写：并发两次点击不该产生唯一键冲突。
   * `updated_by` 现在固定 'local'（v1 无账号体系）。
   */
  async toggle(name: string, enabled: boolean): Promise<SkillDetailResponse> {
    const scan = this.scan();
    const skill = this.findByName(scan, name);

    await this.db.query(
      `INSERT INTO skill_switches (name, enabled, updated_at, updated_by)
       VALUES ($1, $2, now(), 'local')
       ON CONFLICT (name) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
      [skill.name, enabled],
    );
    this.logger.log(`skill ${skill.name} 已${enabled ? '启用' : '禁用'}`);

    return this.detail(skill.name);
  }

  /**
   * 「此刻启动 agent，system message 长什么样」。
   *
   * 这是票 15 那条「禁用必须真的摘掉」的可观测证据：禁用的 skill 名字
   * **不会**出现在 `systemMessage` 里，只会出现在 `excludedSkills` 里。
   * 页面直接展示这一段，开关按下去能立刻看到体变短。
   */
  async systemPreview(): Promise<SkillSystemPreviewResponse> {
    const scan = this.scan();
    const switches = await this.readSwitches();

    const enabled: ScannedSkill[] = [];
    const excluded: string[] = [];
    for (const skill of scan.skills) {
      if (this.isEnabled(skill.name, switches)) enabled.push(skill);
      else excluded.push(skill.name);
    }

    const composed = composeSkillSystemMessage(
      { basePrompt: BASE_AGENT_PROMPT, enabled },
      excluded,
    );

    return SkillSystemPreviewResponseSchema.parse({
      systemMessage: composed.systemMessage,
      includedSkills: composed.includedSkills,
      excludedSkills: composed.excludedSkills,
    });
  }

  /**
   * 供回合服务使用的**同一份**组装逻辑。
   *
   * 回合服务不走 HTTP，但它必须和预览接口看到完全一样的体——否则
   * 「预览里禁用了、实际调用还在用」这类问题永远查不出来。
   */
  async composeSystemMessage(): Promise<string> {
    const preview = await this.systemPreview();
    return preview.systemMessage;
  }
}
