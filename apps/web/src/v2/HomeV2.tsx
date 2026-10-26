/*
 * HomeV2 —— 学习页，按已通过样例（cx-1.png / cx-2.png）从零写。
 *
 * 与旧 HomePage 的关系：**不复用它的任何 JSX 与样式**。旧页是六轮返工的叠加物，
 * 里面同时有标题区、说明段、右侧三块堆叠卡片、被裁掉的输入条；继续在上面打补丁
 * 只会越改越像补丁。这里只复用两样东西：数据 hook（`useAgentTurns`/`useSubmitTurn`）
 * 与卡片组件（`ArtifactCard`，它已经过独立验收）。
 *
 * 版式取自样例的四个硬数字：左轨 48 · 会话列 200 · 内容列 920 居中 · 日志列 300。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAgentTurns, useSubmitTurn } from '../api/queries/agent';
import { useTierOverview } from '../api/queries/tier';
import { ArtifactCard } from '../agent/ArtifactCard';
import { Composer } from '../components/Composer';
import { NowLearningCard } from '../components/NowLearningCard';
import { SessionLimitCard } from '../components/SessionLimitCard';
import { TierCard } from '../components/TierCard';
import { Rail } from './Rail';
import { currentSessionId } from '../agent/session';
import type { AgentTurnResponse } from '../api/generated/model';
import type { KpProgressView } from '@starmap/api-contract';
import './v2.css';

type Row = { id?: string; utterance?: string; visibleResponse?: string | null; createdAt?: string };

export function HomeV2() {
  const [sessionId, setSessionId] = useState(() => currentSessionId());
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string>('');
  /*
   * 知识点焦点来自地址栏 `?kp=`（「换个知识点」搜索与详情页「问助手」共用这条链）。
   * 用 useSearchParams 而不是挂载时读一次：同一路由内导航（搜索选点）不会重挂
   * 组件，只读一次的话右栏会一直停在旧知识点上。
   */
  const [searchParams] = useSearchParams();
  const kpId = searchParams.get('kp');
  const [kpName, setKpName] = useState<string | null>(null);
  useEffect(() => {
    if (!kpId) {
      setKpName(null);
      return;
    }
    let alive = true;
    fetch(`/api/v1/nodes/${encodeURIComponent(kpId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { node?: { name?: string } } | null) => {
        if (alive && json?.node?.name) setKpName(json.node.name);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kpId]);

  /*
   * 本知识点进度（票 89）。三个数字全部来自 `GET /api/v1/mastery/kp/:id`：
   * 阈值（8 / 3 / 连对 2）与比例都由服务端给，前端不硬编码、不做除法。
   * 以前这里显示「作答 474/8」，因为分子喂的是累计作答数；接口现在发的是
   * 本关数字（服务端已饱和到阈值），累计真数留在 `cumulative` 里做悬浮说明。
   */
  const [progress, setProgress] = useState<KpProgressView | null>(null);
  useEffect(() => {
    if (!kpId) {
      setProgress(null);
      return;
    }
    let alive = true;
    fetch(`/api/v1/mastery/kp/${encodeURIComponent(kpId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: KpProgressView | null) => {
        if (alive) setProgress(json);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [kpId]);

  const [advice, setAdvice] = useState<Array<{ id: string; text: string; prompt: string }>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/v1/recommendations')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((json: { recommendations?: Array<{ microKpId?: string; name?: string; gating?: { mode?: string } }> }) => {
        if (!alive) return;
        const items = Array.isArray(json.recommendations) ? json.recommendations : [];
        setAdvice(
          items.slice(0, 3).map((it, i) => ({
            id: it.microKpId ?? `a-${i}`,
            text: `${it.name ?? '这个知识点'}：${it.gating?.mode === 'none' ? '没有前置要求，可以直接开始' : '前置已满足，可以开始'}`,
            /* 点一下就真的开始：这句会原样发出去，等同学生自己打的字 */
            prompt: `我想学${it.name ?? '这个知识点'}`,
          })),
        );
      })
      .catch(() => {
        /* 建议读不到不影响主流程 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const history = useAgentTurns(sessionId);
  /* 逐字流的两块状态：已到达的阶段行、已到达的可见文本。
     它们只服务于「等待期间」的展示，提交成功后由 latest（done 帧）接管。
     为什么要分开：阶段行是结构化事件，文本是增量字节；混在一个数组里排序会乱。 */
  const [stages, setStages] = useState<{ stage: string; detail: string }[]>([]);
  const [live, setLive] = useState('');
  const submit = useSubmitTurn(sessionId, {
    onStage: (e) => setStages((prev) => [...prev, { stage: e.stage, detail: e.detail }]),
    onToken: (delta) => setLive((prev) => prev + delta),
  });

  const rows: Row[] = useMemo(() => {
    const payload = (history.data as { data?: { items?: Row[] } } | undefined)?.data;
    return payload?.items ?? [];
  }, [history.data]);

  const latest: AgentTurnResponse | undefined = submit.data;
  useEffect(() => {
    // 测试环境（jsdom）没有 scrollTo：有则滚，无则跳过，不因此炸掉整页。
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [rows.length, latest]);

  /*
   * 提交回合带的档位必须是真的当前档位（票 12 纪律），不能写死 P2。
   * useTierOverview 与右栏 TierCard 共用 react-query 缓存，不会发两次；
   * 接口没回来前回落 P1（与 HomePage 的两显式写法一致）。
   */
  const { payload: tierOverview } = useTierOverview();
  const submitTier = tierOverview?.tier ?? 'P1';

  /* 右栏的「建议」「常用指令」都走这一个出口：点了就等于学生自己说了一句话。
     不在右栏另写一套提交逻辑，否则两处行为迟早不一致。 */
  const sendText = (raw: string) => {
    const text = raw.trim();
    if (!text || submit.isPending) return;
    setSent(text);
    setDraft('');
    setStages([]);
    setLive('');
    submit.mutate({ utterance: text, microKpId: '', tier: submitTier });
  };

  const send = () => sendText(draft);

  /* 档位卡的展示（pill/来源两态/basis 判定依据句）由 TierCard 自取数渲染；
     本页不再自己读 /placement——两个来源迟早说两套话（票 09 集成）。 */
  return (
    <>
      <main className="v2-main">
        <div className="v2-col" ref={listRef}>
          {/*
            * 顶部不再有「学习 / STARMAP / 说一句你想学什么…」那三行。
            * 用户 s(m39578) 明确要求删掉它，改为「中栏页面居中展示：问好等内容」。
            *
            * 为什么不是简单删掉：删空后首屏就成了「一个空输入框挂在底部」，
            * 没有东西告诉学习者该干什么。所以把这一行文字挪到中栏的**垂直居中位置**，
            * 并改成一句问好 + 一句说明（`v2-hello`），只在本轮还没有任何卡片时出现。
            */}
          {!sent && !latest && (
            <div className="v2-hello">
              <p className="v2-hello-hi">今天想学点什么？</p>
              <p className="v2-hello-sub">
                说一句你想学什么，或者你卡在哪一步。每轮只给一张卡片：一个关卡、一张图谱、一次追问，或一段进度。
              </p>
            </div>
          )}

          {sent && (
            <div className="v2-me">
              <p>{sent}</p>
            </div>
          )}

          {submit.isPending && stages.length === 0 && (
            <p className="v2-say">正在准备这一轮的卡片…</p>
          )}

          {stages.length > 0 && (
            <div className="v2-trace">
              {stages.map((s, i) => (
                <div className="v2-trace-row" key={`${s.stage}-${i}`}>
                  <span className="v2-trace-stage">{s.stage}</span>
                  <span className="v2-trace-detail">{s.detail}</span>
                </div>
              ))}
            </div>
          )}

          {live && (
            <div className="v2-card v2-live">
              <p>{live}</p>
            </div>
          )}
          {submit.isError && (
            <p className="v2-say" style={{ color: 'var(--sm-warning-text, #8a5200)' }}>
              这一轮没提交成功：{submit.error instanceof Error ? submit.error.message : '未知错误'}。你的话还在，可以直接重试。
            </p>
          )}

          {latest?.artifact && (
            <div className="v2-card">
              <ArtifactCard artifact={latest.artifact} />
            </div>
          )}

          {latest?.trace && <TracePanel trace={latest.trace as TraceShape} />}
        </div>

        {/*
          * 票 03 收口：Composer 的 context 插槽与 tierLabel 已删除（B5 定版，
          * 输入区一整块）。v2 首页的知识点细条随之消失——知识点身份的展示位
          * 是 v1 右栏的「正在学」卡；v2 自己的右栏仍有「本知识点进度」一行带名字。
          */}
        <Composer
          className="v2-composer"
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          busy={submit.isPending}
          modelLabel="DeepSeek V4"
        />

      </main>

      <aside className="v2-log" aria-label="学习档案">
        {/* 学习页右栏也放同一份学科看板（用户要求「每页特色右栏」，
            但学科进度/正在学/已掌握这三块是跨页共用的，各页自己再写一遍
            就会像之前那样出现两套数字）。 */}
        <h2>学习档案</h2>
        <Rail />
        <div className="v2-archive">
          {/* 票 09 集成：学习档案四卡与 StudySidebar 同源（正在学/档位/进度/上限），
              冷启动没有 kp 时「正在学」卡也挂——搜索与地图入口是第一秒就该有的。 */}
          <NowLearningCard microKpId={kpId} microKpName={kpName} />
          <TierCard />
          <div className="card" data-kp-progress>
            <div className="metric">
              <b>本知识点进度</b>
              {kpName ?? '未选定知识点'}
            </div>
            {progress === null ? (
              <div className="why">
                {kpId ? '正在读进度…' : '还没选知识点：去知识地图点一个，或用上面「换个知识点」按名字找。'}
              </div>
            ) : (
              <>
                {progress.gates
                  /* 票 06 起连对进档位卡的 basis 句，进度卡只剩作答/变式两行 */
                  .filter((gate) => gate.key !== 'streak')
                  .map((gate) => (
                    <div
                      className="gate"
                      key={gate.key}
                      data-gate={gate.key}
                      data-reached={gate.reached ? 'true' : 'false'}
                    >
                      <span className="gate-label">{gate.label}</span>
                      <span className="gate-track" aria-hidden>
                        {/* 宽度直接用服务端算好的比例：前端不做除法 */}
                        <i
                          className="gate-fill"
                          data-tone={progress.gatePassed ? 'success' : 'neutral'}
                          style={{ width: `${Math.round(gate.ratio * 100)}%` }}
                        />
                      </span>
                      <span
                        className="gate-value"
                        title={
                          gate.cumulative > gate.target
                            ? `本关累计 ${gate.cumulative} ${gate.unit}，已到线（阈值 ${gate.target}）`
                            : `本关 ${gate.value} ${gate.unit}，阈值 ${gate.target}`
                        }
                      >
                        {gate.value} / {gate.target} {gate.unit}
                      </span>
                    </div>
                  ))}
                <div className="why">
                  {progress.gatePassed
                    ? `本关判定已达标${progress.gateEvaluatedAt ? `（${new Date(progress.gateEvaluatedAt).toLocaleDateString('zh-CN')}）` : ''}`
                    : `本关判定还没达标${progress.levelTitle ? `：${progress.levelTitle}` : ''}`}
                </div>
              </>
            )}
          </div>
          <SessionLimitCard />
        </div>
        <h2>学习日志</h2>
        <h3>实时建议</h3>
        {advice.length === 0 ? (
          <div className="row">还没有建议。说一句你想学什么，这里会出现三条。</div>
        ) : (
          <ul className="advice">
            {advice.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="advice-btn"
                  onClick={() => { setDraft(a.prompt); sendText(a.prompt); }}
                  disabled={submit.isPending}
                  title={`点击直接用：${a.prompt}`}
                >
                  {a.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        <h3>这一会话</h3>
        {rows.length === 0 && <div className="row">还没有记录。说第一句话后这里会出现。</div>}
        {rows.slice(-6).reverse().map((row, i) => (
          <div className="row" key={row.id ?? `log-${i}`}>
            {row.visibleResponse ?? row.utterance ?? '（空记录）'}
            <time>{row.createdAt ? new Date(row.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
          </div>
        ))}
      </aside>
    </>
  );
}


/** 决策链的四段结构（后端 `buildTrace` 的镜像；字段缺失都要能容忍） */
interface TraceShape {
  skills?: Array<{ name: string; description?: string }>;
  retrieval?: {
    candidates?: number;
    allowed?: number;
    used?: number;
    chunks?: Array<{ chunkId: string | null; score: number | null; allowed: boolean; gateReason: string | null; excerpt: string }>;
  };
  decisions?: { tier?: string | null; focusNote?: string | null; retryCount?: number; degraded?: boolean; degradedReason?: string | null };
  model?: { name?: string | null; latencyMs?: number | null; reasoning?: string | null };
}

/**
 * 决策链面板。
 *
 * 只展示**有据可查**的四类事实：注入了哪些 skill、检索命中了什么、
 * 本项目做了哪些判定、模型叫什么与耗时多少。模型的 `reasoning` 如果为空，
 * 就明写「该模型未返回推理内容」—— 不编一段思考过程：那会是整页里
 * 唯一无法核对的内容，比不展示更糟。
 */
function TracePanel({ trace }: { trace: TraceShape }) {
  const skills = trace.skills ?? [];
  const retrieval = trace.retrieval ?? {};
  const decisions = trace.decisions ?? {};
  const model = trace.model ?? {};
  const chunks = retrieval.chunks ?? [];
  return (
    <details className="v2-trace">
      <summary>
        决策链 · 技能 {skills.length} · 检索 {retrieval.used ?? 0}/{retrieval.candidates ?? 0}
        {typeof model.latencyMs === 'number' ? ` · ${Math.round(model.latencyMs)}ms` : ''}
      </summary>
      <section>
        <h4>调用的技能</h4>
        {skills.length === 0 ? (
          <p>本轮没有注入技能（技能库为空或全部禁用）。</p>
        ) : (
          <ul>
            {skills.map((skill) => (
              <li key={skill.name}>
                <b>{skill.name}</b>
                {skill.description ? ` · ${skill.description}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>检索与门控</h4>
        <p>
          候选 {retrieval.candidates ?? 0} 条 · 门控放行 {retrieval.allowed ?? 0} 条 · 实际用于本轮 {retrieval.used ?? 0} 条
        </p>
        {chunks.length > 0 && (
          <ol>
            {chunks.map((chunk, index) => (
              <li key={`${chunk.chunkId ?? 'x'}-${index}`}>
                <code>{chunk.chunkId ?? '（无 id）'}</code>
                {typeof chunk.score === 'number' ? ` · 分数 ${chunk.score}` : ''}
                {` · ${chunk.allowed ? '放行' : '拦截'}`}
                {chunk.gateReason ? `（${chunk.gateReason}）` : ''}
                <div>{chunk.excerpt}</div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section>
        <h4>判定</h4>
        <p>
          档位 {decisions.tier ?? '—'} · 焦点 {decisions.focusNote ?? '—'}
          {typeof decisions.retryCount === 'number' && decisions.retryCount > 0 ? ` · 重试 ${decisions.retryCount} 次` : ''}
          {decisions.degraded ? ` · 已降级（${decisions.degradedReason ?? '原因未记录'}）` : ' · 未降级'}
        </p>
      </section>
      <section>
        <h4>模型</h4>
        <p>
          {model.name ?? '未记录模型名'}
          {typeof model.latencyMs === 'number' ? ` · 耗时 ${Math.round(model.latencyMs)}ms` : ''}
        </p>
        {model.reasoning ? (
          <blockquote>{model.reasoning}</blockquote>
        ) : (
          <p className="v2-trace-note">该模型未返回推理内容（provider 不回传 reasoning_content），这里不编造思考过程。</p>
        )}
      </section>
    </details>
  );
}
