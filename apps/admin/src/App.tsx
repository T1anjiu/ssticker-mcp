import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { apiDelete, checkSession, login } from "./api";
import { CatalogPage, DecisionsPage, OverviewPage, ScenesPage, SystemPage, UploadsPage } from "./pages";
import type { PageId } from "./types";

const NAVIGATION: Array<{ id: PageId; label: string; description: string; icon: IconName }> = [
  { id: "overview", label: "概览", description: "待办与健康状态", icon: "overview" },
  { id: "catalog", label: "素材库", description: "审核与元数据", icon: "catalog" },
  { id: "uploads", label: "上传任务", description: "导入与处理结果", icon: "upload" },
  { id: "scenes", label: "场景与策略", description: "分类和发送阈值", icon: "sliders" },
  { id: "decisions", label: "决策记录", description: "匿名结果追溯", icon: "trace" },
  { id: "system", label: "系统", description: "模型、索引与渠道", icon: "system" }
];

export function App() {
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "anonymous">("checking");
  const [page, setPage] = useState<PageId>(() => pageFromHash());
  const [notice, setNotice] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    void checkSession().then((authenticated) => setAuthState(authenticated ? "authenticated" : "anonymous")).catch(() => setAuthState("anonymous"));
  }, []);

  useEffect(() => {
    const listener = () => setPage(pageFromHash());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const notify = (message: string, kind: "success" | "error" = "success") => setNotice({ message, kind });

  if (authState === "checking") {
    return <BootScreen />;
  }
  if (authState === "anonymous") {
    return <LoginScreen onAuthenticated={() => setAuthState("authenticated")} />;
  }

  const current = NAVIGATION.find((item) => item.id === page) ?? NAVIGATION[0]!;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="ssticker 管理端首页">
          <span className="brand-mark" aria-hidden="true">ss</span>
          <span><strong>ssticker</strong><small>Operations</small></span>
        </a>
        <nav className="primary-nav" aria-label="主导航">
          {NAVIGATION.map((item) => (
            <a key={item.id} href={`#${item.id}`} className={page === item.id ? "nav-item is-active" : "nav-item"} aria-current={page === item.id ? "page" : undefined} aria-label={`${item.label} - ${item.description}`}>
              <Icon name={item.icon} />
              <span><strong>{item.label}</strong><small>{item.description}</small></span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="connection-state"><i aria-hidden="true" />本地服务已连接</span>
          <button className="text-button" type="button" onClick={async () => {
            try {
              await apiDelete("/session");
            } finally {
              setAuthState("anonymous");
            }
          }}>退出管理端</button>
        </div>
      </aside>

      <main className="workspace" id="main-content">
        <header className="workspace-header">
          <div>
            <p className="context-line">ssticker / {current.label}</p>
            <h1>{current.label}</h1>
            <p>{current.description}</p>
          </div>
          <span className="privacy-note"><Icon name="privacy" />不保存原始对话</span>
        </header>
        <div className="workspace-content">
          {page === "overview" && <OverviewPage notify={notify} />}
          {page === "catalog" && <CatalogPage notify={notify} />}
          {page === "uploads" && <UploadsPage notify={notify} />}
          {page === "scenes" && <ScenesPage notify={notify} />}
          {page === "decisions" && <DecisionsPage />}
          {page === "system" && <SystemPage notify={notify} />}
        </div>
      </main>
      {notice && <div className={`toast ${notice.kind}`} role="status" aria-live="polite"><Icon name={notice.kind === "success" ? "check" : "warning"} />{notice.message}</div>}
    </div>
  );
}

function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await login(token.trim());
      onAuthenticated();
    } catch {
      setError("令牌无效或已撤销。请使用 CLI 创建新的管理员令牌。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-brand"><span className="brand-mark" aria-hidden="true">ss</span><span>ssticker</span></div>
        <h1 id="login-title">进入素材运营台</h1>
        <p>使用一次性显示的管理员令牌登录。令牌只在本机数据库中保存 Argon2id 哈希。</p>
        <form onSubmit={submit} className="form-stack">
          <label className="field"><span>管理员令牌</span><input type="password" autoComplete="current-password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="sst_admin_…" required /></label>
          {error && <div className="inline-error" role="alert"><Icon name="warning" />{error}</div>}
          <button className="button primary" type="submit" disabled={submitting || token.trim().length < 20}>{submitting ? "正在验证…" : "进入运营台"}</button>
        </form>
        <div className="command-help">
          <span>还没有令牌？</span>
          <code>ssticker admin token create</code>
        </div>
      </section>
    </main>
  );
}

function BootScreen() {
  return <main className="boot-screen" aria-live="polite"><span className="brand-mark" aria-hidden="true">ss</span><span>正在确认本地管理会话…</span></main>;
}

function pageFromHash(): PageId {
  const value = window.location.hash.slice(1) as PageId;
  return NAVIGATION.some((item) => item.id === value) ? value : "overview";
}

type IconName = "overview" | "catalog" | "upload" | "sliders" | "trace" | "system" | "privacy" | "check" | "warning" | "search" | "close" | "refresh" | "arrow" | "file";

export function Icon({ name }: { name: IconName }) {
  const path = useMemo(() => iconPath(name), [name]);
  return <svg className="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>;
}

function iconPath(name: IconName): ReactNode {
  const paths: Record<IconName, ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/></>,
    catalog: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 1 4 17.5z"/><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H20M8 7h8"/></>,
    upload: <><path d="M12 16V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
    sliders: <><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="13" cy="18" r="2"/></>,
    trace: <><path d="M6 3v12a4 4 0 0 0 4 4h8"/><circle cx="6" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/></>,
    system: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1v.1h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4h-.1v-4H3A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1v-.1h4V3A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.1.4.3.7.6 1 .3.2.7.4 1 .4h.1v4H21a1.7 1.7 0 0 0-1.6.6Z"/></>,
    privacy: <><path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    warning: <><path d="M12 3 2.7 20h18.6z"/><path d="M12 9v4M12 17h.01"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
    arrow: <path d="m9 18 6-6-6-6"/>,
    file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/></>
  };
  return paths[name];
}

