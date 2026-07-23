import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { apiGet, apiPatch, apiPost, apiUpload } from "./api";
import { Icon } from "./App";
import type { DashboardStats, DecisionSummary, Job, PolicyProfile, SceneDefinition, Sticker, StickerDetail, StickerStatus, SystemInfo } from "./types";

type Notify = (message: string, kind?: "success" | "error") => void;

export function OverviewPage({ notify }: { notify: Notify }) {
  const stats = useResource<DashboardStats>("/overview");
  const jobs = useResource<{ jobs: Job[] }>("/jobs");
  const decisions = useResource<{ decisions: DecisionSummary[] }>("/decisions?limit=8");
  const refresh = async () => {
    await Promise.all([stats.reload(), jobs.reload(), decisions.reload()]);
    notify("概览已刷新");
  };
  if (stats.loading) return <LoadingTable label="正在读取服务状态" />;
  if (stats.error || !stats.data) return <ErrorState message={stats.error ?? "无法读取概览"} retry={stats.reload} />;
  const value = stats.data;
  const attention = [
    { label: "待审核素材", value: value.pending_review, href: "#catalog", severity: value.pending_review > 0 ? "attention" : "quiet" },
    { label: "失败任务", value: value.failed_jobs, href: "#uploads", severity: value.failed_jobs > 0 ? "danger" : "quiet" },
    { label: "向量索引", value: value.vector_enabled ? "已启用" : "降级模式", href: "#system", severity: value.vector_enabled ? "ok" : "attention" }
  ];
  return (
    <div className="page-flow">
      <div className="page-actions"><button className="button secondary" type="button" onClick={refresh}><Icon name="refresh" />刷新状态</button></div>
      <section className="attention-strip" aria-label="需要关注的状态">
        {attention.map((item) => <a href={item.href} key={item.label} className={`attention-item ${item.severity}`}><span>{item.label}</span><strong>{item.value}</strong><Icon name="arrow" /></a>)}
      </section>
      <section className="data-section">
        <div className="section-heading"><div><h2>运行摘要</h2><p>最近 24 小时的匿名决策与采用情况。</p></div></div>
        <dl className="summary-list">
          <div><dt>素材总数</dt><dd>{value.total_stickers}</dd></div>
          <div><dt>已上线</dt><dd>{value.active_stickers}</dd></div>
          <div><dt>决策调用</dt><dd>{value.decisions_24h}</dd></div>
          <div><dt>实际发送</dt><dd>{value.sent_24h}</dd></div>
          <div><dt>发送采用率</dt><dd>{value.send_decisions_24h ? `${Math.round(value.sent_24h / value.send_decisions_24h * 100)}%` : "—"}</dd></div>
        </dl>
      </section>
      <div className="two-column">
        <section className="data-section">
          <div className="section-heading"><div><h2>近期任务</h2><p>导入、转码和索引任务。</p></div><a href="#uploads">查看全部</a></div>
          <JobList jobs={jobs.data?.jobs.slice(0, 6) ?? []} compact />
        </section>
        <section className="data-section">
          <div className="section-heading"><div><h2>近期决策</h2><p>不包含任何对话原文。</p></div><a href="#decisions">查看全部</a></div>
          <DecisionList decisions={decisions.data?.decisions ?? []} compact />
        </section>
      </div>
    </div>
  );
}

export function CatalogPage({ notify }: { notify: Notify }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StickerStatus | "">("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSaving, setBulkSaving] = useState(false);
  const encoded = new URLSearchParams({ ...(query ? { query } : {}), ...(status ? { status } : {}), limit: "100" });
  const catalog = useResource<{ items: Sticker[]; total: number }>(`/stickers?${encoded.toString()}`);
  const visibleIds = catalog.data?.items.map((sticker) => sticker.id) ?? [];
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id)); else visibleIds.forEach((id) => next.add(id));
    return next;
  });
  const applyBulkStatus = async (nextStatus: "active" | "disabled") => {
    if (selectedIds.size === 0) return;
    setBulkSaving(true);
    try {
      const result = await apiPost<{ results: Array<{ status: "updated" | "failed"; message?: string }> }>("/stickers/bulk-status", { ids: [...selectedIds], status: nextStatus });
      const failures = result.results.filter((item) => item.status === "failed");
      if (failures.length > 0) {
        notify(`已更新 ${result.results.length - failures.length} 个，${failures.length} 个失败：${failures[0]?.message ?? "请检查素材信息"}`, "error");
      } else {
        notify(`已${nextStatus === "active" ? "上线" : "停用"} ${result.results.length} 个素材`);
      }
      setSelectedIds(new Set());
      await catalog.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "批量操作失败", "error");
    } finally {
      setBulkSaving(false);
    }
  };
  return (
    <div className="page-flow">
      <div className="toolbar">
        <label className="search-field"><Icon name="search" /><span className="sr-only">搜索素材</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="标题、外部 ID 或替代文本" /></label>
        <label className="compact-field"><span>状态</span><select value={status} onChange={(event) => setStatus(event.target.value as StickerStatus | "")}><option value="">全部</option><option value="draft">草稿</option><option value="reviewed">待审核</option><option value="active">已上线</option><option value="disabled">已停用</option><option value="blocked">已阻断</option></select></label>
        <span className="result-count">{catalog.data?.total ?? 0} 个素材</span>
      </div>
      {selectedIds.size > 0 && <div className="bulk-toolbar" role="region" aria-label="批量素材操作"><strong>已选择 {selectedIds.size} 个</strong><span>上线前会逐项校验授权、安全和变体。</span><div><button className="button secondary" type="button" disabled={bulkSaving} onClick={() => void applyBulkStatus("disabled")}>批量停用</button><button className="button primary" type="button" disabled={bulkSaving} onClick={() => void applyBulkStatus("active")}>{bulkSaving ? "处理中…" : "批量上线"}</button></div></div>}
      <section className="table-shell" aria-labelledby="catalog-title">
        <h2 id="catalog-title" className="sr-only">素材列表</h2>
        {catalog.loading ? <LoadingTable label="正在读取素材库" /> : catalog.error ? <ErrorState message={catalog.error} retry={catalog.reload} /> : !catalog.data?.items.length ? <EmptyState title="还没有匹配的素材" description={query || status ? "调整搜索和状态筛选，或清除筛选条件。" : "前往上传任务导入第一批有授权的素材。"} action={query || status ? <button className="button secondary" onClick={() => { setQuery(""); setStatus(""); }}>清除筛选</button> : <a className="button primary" href="#uploads">导入素材</a>} /> : (
          <div className="table-scroll"><table><thead><tr><th className="select-cell"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label={allVisibleSelected ? "取消选择当前页全部素材" : "选择当前页全部素材"} /></th><th>素材</th><th>状态</th><th>安全</th><th>素材包</th><th>强度</th><th>更新时间</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{catalog.data.items.map((sticker) => (
            <tr key={sticker.id} className={selectedIds.has(sticker.id) ? "is-selected" : undefined}><td className="select-cell"><input type="checkbox" checked={selectedIds.has(sticker.id)} onChange={() => toggle(sticker.id)} aria-label={`选择 ${sticker.title}`} /></td><td><button className="entity-button" type="button" onClick={() => setSelectedId(sticker.id)}>{sticker.thumbnail_url ? <img className="table-thumbnail" src={sticker.thumbnail_url} alt="" /> : <span className="thumbnail-placeholder" aria-hidden="true">{sticker.title.slice(0, 1)}</span>}<span><strong>{sticker.title}</strong><small>{sticker.external_id}</small></span></button></td><td><StatusBadge status={sticker.status} /></td><td><StatusBadge status={sticker.safety} /></td><td>{sticker.pack}</td><td>{Math.round(sticker.intensity * 100)}%</td><td>{formatTime(sticker.updated_at)}</td><td><button className="icon-button" type="button" aria-label={`查看 ${sticker.title}`} onClick={() => setSelectedId(sticker.id)}><Icon name="arrow" /></button></td></tr>
          ))}</tbody></table></div>
        )}
      </section>
      {selectedId && <StickerDrawer stickerId={selectedId} close={() => setSelectedId(null)} saved={async (message) => { notify(message); await catalog.reload(); }} notify={notify} />}
    </div>
  );
}

function StickerDrawer({ stickerId, close, saved, notify }: { stickerId: string; close: () => void; saved: (message: string) => Promise<void>; notify: Notify }) {
  const resource = useResource<StickerDetail>(`/stickers/${stickerId}`);
  const [form, setForm] = useState<StickerDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (resource.data) setForm(resource.data); }, [resource.data]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      previousFocus?.focus();
    };
  }, [close]);
  const changeSticker = <K extends keyof Sticker>(key: K, value: Sticker[K]) => setForm((current) => current ? { ...current, sticker: { ...current.sticker, [key]: value } } : current);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      await apiPatch(`/stickers/${stickerId}`, {
        title: form.sticker.title,
        alt_text: form.sticker.alt_text,
        status: form.sticker.status,
        safety: form.sticker.safety,
        license: form.sticker.license,
        source: form.sticker.source,
        attribution: form.sticker.attribution,
        pack: form.sticker.pack,
        audience: form.sticker.audience,
        intensity: form.sticker.intensity,
        tones: form.sticker.tones,
        tags: form.tags,
        scenes: form.scenes
      });
      await saved("素材元数据已保存");
      await resource.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "保存失败", "error");
    } finally {
      setSaving(false);
    }
  };
  const review = async (approved: boolean) => {
    try {
      await apiPost(`/stickers/${stickerId}/review`, { approved });
      await saved(approved ? "素材已审核上线" : "素材已阻断");
      await resource.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "审核失败", "error");
    }
  };
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside ref={drawerRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
    <header className="drawer-header"><div><p>素材详情</p><h2 id="drawer-title">{form?.sticker.title ?? "正在读取"}</h2></div><button ref={closeButtonRef} className="icon-button" type="button" onClick={close} aria-label="关闭详情"><Icon name="close" /></button></header>
    {resource.loading || !form ? <LoadingTable label="正在读取素材详情" /> : resource.error ? <ErrorState message={resource.error} retry={resource.reload} /> : <form className="drawer-form" onSubmit={submit}>
      <div className="media-preview">{form.variants[0] ? <img src={form.variants[0].download_url} alt={form.sticker.alt_text["zh-CN"] ?? form.sticker.title} /> : <span>没有可预览变体</span>}</div>
      <div className="status-row"><StatusBadge status={form.sticker.status} /><StatusBadge status={form.sticker.safety} /><span className="plain-chip">{form.variants.length} 个变体</span></div>
      <fieldset><legend>基本信息</legend><label className="field"><span>标题</span><input value={form.sticker.title} onChange={(event) => changeSticker("title", event.target.value)} required /></label><div className="field-pair"><label className="field"><span>中文替代文本</span><textarea value={form.sticker.alt_text["zh-CN"] ?? ""} onChange={(event) => changeSticker("alt_text", { ...form.sticker.alt_text, "zh-CN": event.target.value })} required /></label><label className="field"><span>英文替代文本</span><textarea value={form.sticker.alt_text.en ?? ""} onChange={(event) => changeSticker("alt_text", { ...form.sticker.alt_text, en: event.target.value })} required /></label></div><div className="field-pair"><label className="field"><span>素材包</span><input value={form.sticker.pack} onChange={(event) => changeSticker("pack", event.target.value)} /></label><label className="field"><span>受众</span><select value={form.sticker.audience} onChange={(event) => changeSticker("audience", event.target.value as Sticker["audience"])}><option value="any">通用</option><option value="direct">私聊</option><option value="group">群聊</option></select></label></div></fieldset>
      <fieldset><legend>授权与来源</legend><label className="field"><span>许可证</span><input value={form.sticker.license} onChange={(event) => changeSticker("license", event.target.value)} placeholder="例如 CC0-1.0 或自有授权" required /></label><label className="field"><span>来源</span><input value={form.sticker.source} onChange={(event) => changeSticker("source", event.target.value)} /></label><label className="field"><span>署名</span><input value={form.sticker.attribution} onChange={(event) => changeSticker("attribution", event.target.value)} /></label></fieldset>
      <fieldset><legend>分类与强度</legend><label className="field"><span>场景与权重</span><input value={form.scenes.map((item) => `${item.id}:${item.weight}`).join(", ")} onChange={(event) => setForm({ ...form, scenes: parseWeightedList(event.target.value) })} placeholder="joy:0.9, celebration:0.7" /></label><label className="field"><span>标签</span><input value={form.tags.join(", ")} onChange={(event) => setForm({ ...form, tags: parseList(event.target.value) })} /></label><label className="field"><span>语气</span><input value={form.sticker.tones.join(", ")} onChange={(event) => changeSticker("tones", parseList(event.target.value))} /></label><label className="range-field"><span>强度 <strong>{Math.round(form.sticker.intensity * 100)}%</strong></span><input type="range" min="0" max="1" step="0.05" value={form.sticker.intensity} onChange={(event) => changeSticker("intensity", Number(event.target.value))} /></label></fieldset>
      <fieldset><legend>处理变体</legend><div className="variant-list">{form.variants.map((variant) => <div key={variant.id}><span><strong>{variant.name}</strong><small>{variant.mime_type} · {variant.width}×{variant.height}</small></span><span>{formatBytes(variant.bytes)}</span></div>)}</div></fieldset>
      <div className="drawer-actions"><button className="button primary" type="submit" disabled={saving}>{saving ? "保存中…" : "保存更改"}</button><button className="button secondary" type="button" onClick={() => review(true)}>审核上线</button><button className="button danger-text" type="button" onClick={() => review(false)}>阻断素材</button></div>
    </form>}
  </aside></div>;
}

export function UploadsPage({ notify }: { notify: Notify }) {
  const jobs = useResource<{ jobs: Job[] }>("/jobs", 3000);
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [metadata, setMetadata] = useState({ license: "", source: "", attribution: "", pack: "default", tags: "", scenes: "" });
  const [uploading, setUploading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.length) return;
    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    form.set("metadata", JSON.stringify({ ...metadata, tags: parseList(metadata.tags), scenes: parseWeightedList(metadata.scenes) }));
    setUploading(true);
    try {
      const result = await apiUpload<{ jobs: Job[] }>("/uploads", form);
      notify(`已创建 ${result.jobs.length} 个导入任务`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await jobs.reload();
    } catch (error) {
      notify(error instanceof Error ? error.message : "上传失败", "error");
    } finally {
      setUploading(false);
    }
  };
  return <div className="page-flow"><section className="data-section upload-section"><div className="section-heading"><div><h2>上传素材</h2><p>单文件不超过 20 MB，每批最多 50 个；所有文件先进入审核。</p></div></div><form className="upload-form" onSubmit={submit}><label className="drop-zone"><Icon name="upload" /><strong>{files.length ? `已选择 ${files.length} 个文件` : "选择 PNG、JPEG、WebP 或 GIF"}</strong><span>{files.length ? files.map((file) => file.name).slice(0, 3).join("、") : "点击选择文件；大批量导入请使用 CLI 清单"}</span><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /></label><div className="field-grid"><label className="field"><span>许可证</span><input value={metadata.license} onChange={(event) => setMetadata({ ...metadata, license: event.target.value })} placeholder="CC0-1.0 / 自有授权" /></label><label className="field"><span>素材包</span><input value={metadata.pack} onChange={(event) => setMetadata({ ...metadata, pack: event.target.value })} /></label><label className="field"><span>来源</span><input value={metadata.source} onChange={(event) => setMetadata({ ...metadata, source: event.target.value })} /></label><label className="field"><span>署名</span><input value={metadata.attribution} onChange={(event) => setMetadata({ ...metadata, attribution: event.target.value })} /></label><label className="field"><span>标签</span><input value={metadata.tags} onChange={(event) => setMetadata({ ...metadata, tags: event.target.value })} placeholder="可爱, 猫, 反应" /></label><label className="field"><span>场景与权重</span><input value={metadata.scenes} onChange={(event) => setMetadata({ ...metadata, scenes: event.target.value })} placeholder="joy:0.9, laughter:0.7" /></label></div><button className="button primary" type="submit" disabled={!files.length || uploading}>{uploading ? "正在上传…" : "创建导入任务"}</button></form></section><section className="data-section"><div className="section-heading"><div><h2>处理任务</h2><p>页面会自动刷新；失败任务最多重试三次。</p></div><button className="button secondary" onClick={jobs.reload}><Icon name="refresh" />刷新</button></div>{jobs.loading && !jobs.data ? <LoadingTable label="正在读取任务" /> : jobs.error ? <ErrorState message={jobs.error} retry={jobs.reload} /> : <JobList jobs={jobs.data?.jobs ?? []} />}</section></div>;
}

export function ScenesPage({ notify }: { notify: Notify }) {
  const scenes = useResource<{ scenes: SceneDefinition[] }>("/scenes");
  const policy = useResource<PolicyProfile>("/policies/default");
  const [draft, setDraft] = useState<PolicyProfile | null>(null);
  useEffect(() => { if (policy.data) setDraft(policy.data); }, [policy.data]);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    try {
      const saved = await apiPatch<PolicyProfile>("/policies/default", draft);
      setDraft(saved);
      notify(`策略已保存为版本 ${saved.version}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "策略保存失败", "error");
    }
  };
  return <div className="two-column policy-layout"><section className="data-section"><div className="section-heading"><div><h2>场景分类</h2><p>稳定英文 ID 与中英双语原型。</p></div><span className="plain-chip">{scenes.data?.scenes.length ?? 0} 个场景</span></div>{scenes.loading ? <LoadingTable label="正在读取场景" /> : scenes.error ? <ErrorState message={scenes.error} retry={scenes.reload} /> : <div className="scene-list">{scenes.data?.scenes.map((scene) => <details key={scene.id}><summary><span><strong>{scene.label_zh}</strong><code>{scene.id}</code></span><span>{Math.round(scene.default_intensity * 100)}%</span></summary><div><p>{scene.description_zh}</p><p className="muted-copy">{scene.description_en}</p><div className="tag-row">{scene.default_tones.map((tone) => <span className="plain-chip" key={tone}>{tone}</span>)}</div><p className="keyword-copy">关键词：{[...scene.keywords_zh, ...scene.keywords_en].join("、")}</p></div></details>)}</div>}</section><section className="data-section policy-editor"><div className="section-heading"><div><h2>默认发送策略</h2><p>更改后立即用于新的推荐请求。</p></div>{draft && <span className="plain-chip">v{draft.version}</span>}</div>{!draft ? <LoadingTable label="正在读取策略" /> : <form className="form-stack" onSubmit={save}><PolicyField label="自动发送阈值" field="auto_threshold" value={draft} setValue={setDraft} step="0.01" /><PolicyField label="显式请求阈值" field="explicit_threshold" value={draft} setValue={setDraft} step="0.01" /><PolicyField label="场景置信阈值" field="scene_threshold" value={draft} setValue={setDraft} step="0.01" /><PolicyField label="候选分差阈值" field="margin_threshold" value={draft} setValue={setDraft} step="0.01" /><PolicyField label="私聊冷却（秒）" field="direct_cooldown_seconds" value={draft} setValue={setDraft} /><PolicyField label="私聊轮次间隔" field="direct_turn_gap" value={draft} setValue={setDraft} /><PolicyField label="群聊冷却（秒）" field="group_cooldown_seconds" value={draft} setValue={setDraft} /><PolicyField label="群聊消息间隔" field="group_message_gap" value={draft} setValue={setDraft} /><PolicyField label="最近去重窗口" field="recent_duplicate_window" value={draft} setValue={setDraft} /><PolicyField label="事件保留（小时）" field="event_ttl_hours" value={draft} setValue={setDraft} /><button className="button primary" type="submit">保存策略</button></form>}</section></div>;
}

function PolicyField({ label, field, value, setValue, step = "1" }: { label: string; field: keyof PolicyProfile; value: PolicyProfile; setValue: (value: PolicyProfile) => void; step?: string }) {
  return <label className="field"><span>{label}</span><input type="number" min="0" max={step === "0.01" ? "1" : undefined} step={step} value={value[field]} onChange={(event) => setValue({ ...value, [field]: Number(event.target.value) })} /></label>;
}

export function DecisionsPage() {
  const decisions = useResource<{ decisions: DecisionSummary[] }>("/decisions?limit=200", 5000);
  return <section className="data-section"><div className="section-heading"><div><h2>匿名决策追溯</h2><p>只显示场景、原因、渠道和反馈，不保存对话原文。</p></div><button className="button secondary" onClick={decisions.reload}><Icon name="refresh" />刷新</button></div>{decisions.loading && !decisions.data ? <LoadingTable label="正在读取决策" /> : decisions.error ? <ErrorState message={decisions.error} retry={decisions.reload} /> : <DecisionList decisions={decisions.data?.decisions ?? []} />}</section>;
}

export function SystemPage({ notify }: { notify: Notify }) {
  const system = useResource<SystemInfo>("/system");
  const rebuild = async () => {
    try {
      await apiPost("/index/rebuild", {});
      notify("索引重建任务已加入队列");
    } catch (error) {
      notify(error instanceof Error ? error.message : "无法创建索引任务", "error");
    }
  };
  if (system.loading) return <LoadingTable label="正在读取系统信息" />;
  if (system.error || !system.data) return <ErrorState message={system.error ?? "无法读取系统信息"} retry={system.reload} />;
  const info = system.data;
  return <div className="page-flow"><section className="data-section"><div className="section-heading"><div><h2>服务与索引</h2><p>运行路径和模型密钥不会显示在此页面。</p></div><StatusBadge status={info.health.vector ? "ready" : "degraded"} /></div><dl className="definition-list"><div><dt>数据库</dt><dd>{info.health.database} · migration {info.health.migrations}</dd></div><div><dt>在线索引</dt><dd>generation {info.health.index_generation} · A/B 原子切换</dd></div><div><dt>向量扩展</dt><dd>{info.health.vector ? "sqlite-vec 已启用" : "全文与进程内相似度降级"}</dd></div><div><dt>嵌入提供方</dt><dd>{info.config.embedding_provider} · {info.config.model_id}</dd></div><div><dt>LLM 分类器</dt><dd>{info.config.llm_configured ? "已配置" : "未配置（可正常运行）"}</dd></div><div><dt>鉴权模式</dt><dd>{info.config.auth_mode}</dd></div><div><dt>数据目录</dt><dd><code>{info.config.data_dir}</code></dd></div></dl><button className="button primary" type="button" onClick={rebuild}>重建素材索引</button></section><section className="data-section"><div className="section-heading"><div><h2>渠道能力配置</h2><p>推荐只选择满足对应 profile 限制的变体。</p></div><span className="plain-chip">{info.profiles.length} 个 profile</span></div><div className="profile-list">{info.profiles.map((profile) => <div key={profile.id}><span><strong>{profile.id}</strong><small>{profile.platform} · v{profile.version}</small></span><span>核对于 {profile.verified_at}</span></div>)}</div></section></div>;
}

function JobList({ jobs, compact = false }: { jobs: Job[]; compact?: boolean }) {
  if (!jobs.length) return <EmptyState title="没有处理任务" description="上传素材或重建索引后，任务会出现在这里。" />;
  return <div className={compact ? "compact-list" : "job-list"}>{jobs.map((job) => <div key={job.id} className="list-row"><Icon name="file" /><span><strong>{job.type}</strong><small>{formatTime(job.created_at)} · 尝试 {job.attempts} 次</small>{job.error && <em>{job.error}</em>}</span><StatusBadge status={job.status} /></div>)}</div>;
}

function DecisionList({ decisions, compact = false }: { decisions: DecisionSummary[]; compact?: boolean }) {
  if (!decisions.length) return <EmptyState title="还没有决策记录" description="AI 调用 recommend_sticker 后，匿名结果会显示在这里。" />;
  if (compact) return <div className="compact-list">{decisions.map((decision) => <div key={decision.id} className="list-row"><span className={`decision-symbol ${decision.action}`} aria-hidden="true">{decision.action === "send" ? "→" : "×"}</span><span><strong>{decision.scene_id}</strong><small>{decision.reason_codes.join(" · ")}</small></span><span>{Math.round(decision.confidence * 100)}%</span></div>)}</div>;
  return <div className="table-scroll"><table><thead><tr><th>决策</th><th>场景</th><th>置信度</th><th>主要原因</th><th>渠道</th><th>结果</th><th>时间</th></tr></thead><tbody>{decisions.map((decision) => <tr key={decision.id}><td><StatusBadge status={decision.action} /></td><td><code>{decision.scene_id}</code></td><td>{Math.round(decision.confidence * 100)}%</td><td><div className="reason-list">{decision.reason_codes.map((reason) => <span key={reason}>{reason}</span>)}</div></td><td>{decision.channel_profile}</td><td>{decision.outcome ? <StatusBadge status={decision.outcome} /> : <span className="muted-copy">未回报</span>}</td><td>{formatTime(decision.created_at)}</td></tr>)}</tbody></table></div>;
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { draft: "草稿", reviewed: "待审核", active: "已上线", disabled: "已停用", blocked: "已阻断", safe: "安全", sensitive: "敏感", queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", send: "发送", skip: "跳过", sent: "已发送", rejected: "已拒绝", ready: "就绪", degraded: "降级" };
  const symbol = ["active", "safe", "completed", "sent", "ready"].includes(status) ? "✓" : ["blocked", "failed", "rejected"].includes(status) ? "!" : ["running", "queued", "reviewed"].includes(status) ? "·" : "—";
  return <span className={`status-badge status-${status}`}><i aria-hidden="true">{symbol}</i>{labels[status] ?? status}</span>;
}

function LoadingTable({ label }: { label: string }) {
  return <div className="skeleton-stack" aria-label={label} role="status">{[0, 1, 2, 3].map((item) => <span key={item} />)}<span className="sr-only">{label}</span></div>;
}

function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span className="empty-symbol" aria-hidden="true">○</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function ErrorState({ message, retry }: { message: string; retry: () => Promise<void> }) {
  return <div className="error-state" role="alert"><Icon name="warning" /><div><h3>无法完成请求</h3><p>{message}</p><button className="button secondary" onClick={retry}>重试</button></div></div>;
}

function useResource<T>(path: string, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await apiGet<T>(path));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setInterval(() => void load(), refreshMs);
    return () => window.clearInterval(timer);
  }, [load, refreshMs]);
  return { data, loading, error, reload: load };
}

function parseList(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((item) => item.trim()).filter(Boolean))];
}

function parseWeightedList(value: string): Array<{ id: string; weight: number }> {
  return parseList(value).map((item) => {
    const [id, rawWeight] = item.split(":");
    return { id: id?.trim() ?? "", weight: Math.min(1, Math.max(0, Number(rawWeight ?? 1))) };
  }).filter((item) => item.id && Number.isFinite(item.weight));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
