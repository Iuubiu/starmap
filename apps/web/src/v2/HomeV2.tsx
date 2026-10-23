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
import { useAgentTurns, useSubmitTurn } from '../api/queries/agent';
import { ArtifactCard } from '../agent/ArtifactCard';
import { Composer } from '../components/Composer';
import { currentSessionId } from '../agent/session';
import type { AgentTurnResponse } from '../api/generated/model';
import type { KpProgressView } from '@starmap/api-contract';
import './v2.css';

type Row = { id?: string; utterance?: string; visibleResponse?: string | null; createdAt?: string };

export function HomeV2() {
  const [sessionId, setSessionId] = useState(() => currentSessionId());
  const [draft, setDraft] = useState('');
  const [sent, setSent] = useState<string>('');
  const [kpName, setKpName] = useState<string | null>(null);
  const [kpId, setKpId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('kp');
    setKpId(id);
    if (!id) {
      setKpName(null);
      return;
    }
    let alive = true;
    fetch(`/api/v1/nodes/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { node?: { name?: string } } | null) => {
        if (alive && json?.node?.name) setKpName(json.node.name);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
  const submit = useSubmitTurn(sessionId);

  const rows: Row[] = useMemo(() => {
    const payload = (history.data as { data?: { items?: Row[] } } | undefined)?.data;
    return payload?.items ?? [];
  }, [history.data]);

  const latest: AgentTurnResponse | undefined = submit.data;
  useEffect(() => {
    // 测试环境（jsdom）没有 scrollTo：有则滚，无则跳过，不因此炸掉整页。
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [rows.length, latest]);

  /* 右栏的「建议」「常用指令」都走这一个出口：点了就等于学生自己说了一句话。
     不在右栏另写一套提交逻辑，否则两处行为迟早不一致。 */
  const sendText = (raw: string) => {
    const text = raw.trim();
    if (!text || submit.isPending) return;
    setSent(text);
    setDraft('');
    submit.mutate({ utterance: text, microKpId: '', tier: 'P2' });
  };

  const send = () => sendText(draft);

  /* 右栏「学习档案」用的三个数：档位取真实 placement，作答/变式暂无接口时显示 0
     （宁可显示 0 也不编造数字——这是本项目一以贯之的规矩）。 */
  /* 档位与进度必须是真数据（用户 m38601 之后的自查）。
     档位读 GET /api/v1/placement；作答/变式目前**没有接口**，因此显示「—」而不是 0 ——
     显示 0 会让人以为「做了 0 题」，而真相是「这个数还没接上」。 */
  const [tier, setTier] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/v1/placement')
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { status?: string; tier?: string } | null) => {
        if (!alive || !json) return;
        setTier(json.tier ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const tierLabel = tier ?? '—';
  return (
    <>
      <main className="v2-main">
        <div className="v2-col" ref={listRef}>
          <h1 className="v2-title">学习</h1>
          <p className="v2-caption">STARMAP</p>
          <p className="v2-say">
            说一句你想学什么，或者你卡在哪一步。每轮只给一张卡片：一个关卡、一张图谱、一次追问，或一段进度。
          </p>

          {sent && (
            <div className="v2-me">
              <p>{sent}</p>
            </div>
          )}

          {submit.isPending && <p className="v2-say">正在准备这一轮的卡片…</p>}
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
        </div>

        <Composer
          className="v2-composer"
          value={draft}
          onChange={setDraft}
          onSubmit={send}
          busy={submit.isPending}
          tierLabel={tierLabel}
          modelLabel="DeepSeek V4"
          context={
            <span className="kpbar">
              <span className="dot" aria-hidden="true" />
              <span className="kpname">{kpName ?? '未选定知识点'}</span>
              {!kpName && <span className="kphint">去知识地图选一个，或直接说你卡在哪一步</span>}
            </span>
          }
        />

      </main>

      <aside className="v2-log" aria-label="学习日志">
        <h2>学习档案</h2>
        <div className="v2-archive">
          <div className="card">
            <div className="tier">
              当前档位 <b>{tierLabel}</b>
            </div>
            <div className="why">
              档位是作答证据的测量结果，不能自选；想改档只能多做题。
            </div>
          </div>
          <div className="card" data-kp-progress>
            <div className="metric">
              <b>本知识点进度</b>
              {kpName ?? '未选定知识点'}
            </div>
            {progress === null ? (
              <div className="why">
                {kpId ? '正在读进度…' : '还没选知识点：去知识地图点一个，或在地址后面加 ?kp=<知识点 id>。'}
              </div>
            ) : (
              <>
                {progress.gates.map((gate) => (
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
                      {gate.value} / {gate.target}
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
