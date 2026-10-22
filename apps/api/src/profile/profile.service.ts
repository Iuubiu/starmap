/**
 * 学习者画像的服务层（票 78）。
 *
 * ## 这一层只做三件事
 *
 * ① 读：表里没有行时返回**全 null 的画像**，而不是 404 或一份带默认值的画像。
 *    前者让「新用户」变成前端要处理的一种错误；后者更糟 —— 那等于用默认值
 *    伪装成学生答过题，票面明确禁止。
 * ② 写：PATCH 语义是「合并」，只覆盖提交上来的键。`null` 是一个**值**（学生
 *    跳过了这一问），必须原样写进 jsonb，不能被 `??` 之类的写法当成「没提交」。
 * ③ 用契约解析一次：读出来的 jsonb 交给 `LearnerProfileSchema.parse`。库里
 *    存的是上一次写入时已经校验过的值，但迁移/手改 SQL 可以绕过写路径 ——
 *    解析失败时要当场炸，而不是让前端拿到一个字段缺失的对象再渲染成空白。
 *
 * ## 为什么写入用 upsert 而不是「先查再插」
 *
 * 单用户场景下并发很低，但「先查后插」在两次请求同时到达时会插两行 ——
 * 而这张表的主键是 `singleton_id`，第二行会撞 23505。用
 * `ON CONFLICT (singleton_id) DO UPDATE` 把这件事交给数据库：要么一行，
 * 要么报错，不会出现「两份画像」这种读端无法裁决的状态。
 */
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  LearnerProfileSchema,
  type LearnerProfile,
  type LearnerProfilePatch,
  type ProfileResponse,
} from '@starmap/api-contract';
import { DatabaseService } from '../db/database.service.js';

/** 表里一行的形状。 */
type ProfileRow = {
  profile: unknown;
  updated_at: Date | string | null;
};

/** 六个字段全 null 的画像 —— 「还什么都没问」。 */
export function emptyProfile(): LearnerProfile {
  return {
    background: null,
    mathLevel: null,
    goal: null,
    weeklyHours: null,
    explanationDensity: null,
    priorCourses: null,
  };
}

/** 已答字段数（非 null 的字段个数）。 */
export function answeredCount(profile: LearnerProfile): number {
  return (Object.values(profile) as unknown[]).filter((v) => v !== null).length;
}

@Injectable()
export class ProfileService {
  constructor(private readonly db: DatabaseService) {}

  async get(): Promise<ProfileResponse> {
    const rows = await this.db.query<ProfileRow>(
      'SELECT profile, updated_at FROM learner_profile WHERE singleton_id = 1',
    );
    const row = rows[0];
    if (!row) return { profile: emptyProfile(), updatedAt: null, answeredCount: 0 };

    const profile = LearnerProfileSchema.safeParse(row.profile);
    if (!profile.success) {
      // 不吞：库里的画像不合契约时，静默回落成空画像等于「学生的答案丢了
      // 但没人知道」。把 zod 的 issues 带出去，定位到具体字段。
      throw new InternalServerErrorException({
        code: 'PROFILE_CORRUPT',
        message: '库里的画像不符合契约',
        details: profile.error.issues,
      });
    }
    return {
      profile: profile.data,
      updatedAt: row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
      answeredCount: answeredCount(profile.data),
    };
  }

  /**
   * 合并式更新：只覆盖 `patch` 里出现的键。
   *
   * 注意这里不校验「空 patch」：`{}` 是合法的（等于没改），返回当前画像即可。
   * 拒绝它只会给前端多一条「没有字段要改时不要发请求」的隐性规则。
   */
  async update(patch: LearnerProfilePatch): Promise<ProfileResponse> {
    const current = await this.get();
    // 空 patch 是合法 no-op：不写库、不改 updatedAt。「没有字段要改」不该让
    // 一张「还没写过」的画像突然长出时间戳。
    if (Object.keys(patch).length === 0) return current;
    // 展开顺序决定语义：先当前值，再提交上来的键。`patch` 里显式的 `null`
    // 会覆盖旧值 —— 那是「跳过 / 清空」，不是「没提交」。
    const merged: LearnerProfile = { ...current.profile, ...patch };
    const parsed = LearnerProfileSchema.safeParse(merged);
    if (!parsed.success) {
      throw new InternalServerErrorException({
        code: 'PROFILE_INVALID',
        message: '合并后的画像不符合契约',
        details: parsed.error.issues,
      });
    }

    const now = await this.db.now();
    await this.db.query(
      `INSERT INTO learner_profile (singleton_id, profile, updated_at)
       VALUES (1, $1::jsonb, $2::timestamptz)
       ON CONFLICT (singleton_id)
       DO UPDATE SET profile = EXCLUDED.profile, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(parsed.data), now],
    );

    return {
      profile: parsed.data,
      updatedAt: now,
      answeredCount: answeredCount(parsed.data),
    };
  }
}
