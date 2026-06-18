import React, { useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Icon, AGENTS, MOMENTS, MEMORIES, USER } from "./store.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { AuthScreen } from "./pages/auth.jsx";
import { ChatListScreen, ChatRoom } from "./pages/chat.jsx";
import { AgentsScreen, AgentEditor, CharacterDetail } from "./pages/agents.jsx";
import { MomentsScreen } from "./pages/moments.jsx";
import { MemoryScreen } from "./pages/memory.jsx";
import { ProfileScreen, OnboardSheet } from "./pages/profile.jsx";

const TABS = [
  { key: "chat",    path: "/chat",       label: "聊天", icon: "chat" },
  { key: "agents",  path: "/characters", label: "角色", icon: "agents" },
  { key: "moments", path: "/moments",    label: "动态", icon: "moments" },
  { key: "memory",  path: "/memory",     label: "记忆", icon: "book" },
  { key: "me",      path: "/profile",    label: "我的", icon: "me" },
];

function AppToast({ toast, onClose }) {
  if (!toast?.text) return null;

  const isError = toast.type === "error";

  return (
    <div className="app-toast-stack" role={isError ? "alert" : "status"} aria-live={isError ? "assertive" : "polite"}>
      <div className={"app-toast " + (isError ? "error" : "success")} key={toast.id}>
        <span className="app-toast-icon"><Icon name={isError ? "alert" : "check"} /></span>
        <span className="app-toast-text">{toast.text}</span>
        <button className="app-toast-close" type="button" aria-label="关闭提示" onClick={onClose}>×</button>
        <span className="app-toast-progress" />
      </div>
    </div>
  );
}

function RuobaiApp({ authed, setAuthed }) {
  const navigate = useNavigate();
  const [agents, setAgents] = useState(AGENTS);
  const [moments, setMoments] = useState(MOMENTS);
  const [memories, setMemories] = useState(MEMORIES);
  const [chatAgent, setChatAgent] = useState(null);
  const [detailAgent, setDetailAgent] = useState(null);
  const [editAgent, setEditAgent] = useState(undefined);
  const [onboardRole, setOnboardRole] = useState(null);

  // 进聊天室时往浏览器历史塞一条记录，让手机系统返回键能正确退回聊天列表，
  // 而不是把聊天室当透明、直接退到更早的页面（甚至退出 app）。
  useEffect(() => {
    if (!chatAgent) return;
    window.history.pushState({ rbChat: true }, "");
    const onPop = () => setChatAgent(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [chatAgent]);

  const saveAgent = (data) => {
    if (data.id) {
      setAgents((p) => p.map((a) => a.id === data.id ? { ...a, ...data } : a));
      setDetailAgent((d) => d?.id === data.id ? { ...d, ...data } : d);
    } else {
      const id = Date.now();
      setAgents((p) => [...p, {
        id, name: data.name || "新角色", handle: "新相遇", persona: data.persona || "", tagline: "",
        cover: data.avatar, avatar: data.avatar, sprite: data.avatar, tags: [], intimacy: 10,
        temp: 28.0, days: 0, autoMoments: data.autoMoments ?? true, rel: "新朋友",
        lastMsg: "我们才刚认识呢。", lastTime: "刚刚", unread: 0, online: true,
      }]);
      setMemories((m) => ({ ...m, [id]: [] }));
    }
    setEditAgent(undefined);
  };
  const deleteAgent = (id) => { setAgents((p) => p.filter((a) => a.id !== id)); setDetailAgent(null); };
  const setMainCompanion = async (id) => {
    try {
      const { switchRole } = await import("./lib/roles.js");
      await switchRole(id);
      setAgents((p) => p.map((a) => ({ ...a, isDefault: a.id === id })));
      setDetailAgent((d) => d ? { ...d, isDefault: d.id === id } : d);
      setTimeout(() => window.dispatchEvent(new Event("focus")), 100);
    } catch (err) {
      console.error("切换主陪伴失败", err);
    }
  };

  const likeMoment = (id) => setMoments((p) => p.map((m) => m.id === id ? { ...m, liked: !m.liked, likes: m.likes + (m.liked ? -1 : 1) } : m));
  const postMoment = (data) => {
    const m = { id: Date.now(), who: "你", agentId: 0, avatar: USER.avatar, tag: "我", tagType: "lav", time: "刚刚", content: data.content, mood: data.mood, images: [], likes: 0, liked: false, comments: [] };
    setMoments((p) => [m, ...p]);
  };

  const addMemory = (aid, d) => setMemories((m) => ({ ...m, [aid]: [{ id: Date.now(), tag: d.tag || "未命名", content: d.content, category: d.category, isImportant: d.isImportant, dateText: "刚刚" }, ...(m[aid] || [])] }));
  const updateMemory = (aid, d) => setMemories((m) => ({ ...m, [aid]: (m[aid] || []).map((x) => x.id === d.id ? { ...x, ...d } : x) }));
  const deleteMemory = (aid, id) => setMemories((m) => ({ ...m, [aid]: (m[aid] || []).filter((x) => x.id !== id) }));
  const pinMemory = (aid, mem) => setMemories((m) => ({ ...m, [aid]: (m[aid] || []).map((x) => x.id === mem.id ? { ...x, isImportant: !x.isImportant } : x) }));

  if (!authed) return <Navigate to="/auth" replace />;

  if (chatAgent) {
    return <div className="rb-app"><div className="viewport"><ChatRoom agent={chatAgent} onBack={() => window.history.back()} /></div></div>;
  }

  function openChat(agent) {
    setDetailAgent(null);
    setChatAgent(agent);
  }

  return (
    <div className="rb-app">
      <div className="viewport">
        <Routes>
          <Route path="/chat" element={<ChatListScreen agents={agents} onOpen={openChat} />} />
          <Route path="/characters" element={<AgentsScreen agents={agents} onChat={openChat} onDetail={setDetailAgent} onCreate={() => setEditAgent(null)} />} />
          <Route path="/moments" element={<MomentsScreen moments={moments} agents={agents} user={USER} onLike={likeMoment} onPost={postMoment} />} />
          <Route path="/memory" element={<MemoryScreen agents={agents} memories={memories} onAdd={addMemory} onUpdate={updateMemory} onDelete={deleteMemory} onPin={pinMemory} />} />
          <Route path="/profile" element={<ProfileScreen user={USER} agents={agents} onGoMemory={() => navigate("/memory")} onLogout={() => { setAuthed(false); navigate("/auth"); }} />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Routes>

        {detailAgent && (
          <CharacterDetail agent={detailAgent} memCount={(memories[detailAgent.id] || []).length}
            onClose={() => setDetailAgent(null)} onChat={openChat}
            onEdit={setEditAgent} onDelete={deleteAgent} onSetMain={setMainCompanion}
            onOnboard={(a) => setOnboardRole(a._raw || a)} />
        )}
      </div>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={location.pathname === t.path ? "tab active" : "tab"}
            onClick={() => { setDetailAgent(null); navigate(t.path); }}>
            <Icon name={t.icon} />
            <span className="lbl">{t.label}</span>
          </button>
        ))}
      </nav>

      {editAgent !== undefined && <AgentEditor agent={editAgent} onClose={() => setEditAgent(undefined)} onSave={saveAgent} />}
      {onboardRole && <OnboardSheet role={onboardRole} onClose={() => setOnboardRole(null)} onDone={() => setOnboardRole(null)} />}
    </div>
  );
}

import { getSession } from "./lib/auth.js";

export default function App() {
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  function showToast(nextToast) {
    const id = Date.now();
    setToast({ id, ...nextToast });
    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast((current) => current?.id === id ? null : current);
    }, 3000);
  }

  useEffect(() => {
    try {
      const t = localStorage.getItem("ruobai_theme");
      if (t) document.documentElement.dataset.theme = t;
    } catch {}

    getSession().then((data) => {
      if (data?.loggedIn) setAuthed(true);
    }).catch(() => {}).finally(() => setChecking(false));

    return () => window.clearTimeout(toastTimerRef.current);
  }, []);

  if (checking) return null; // 等 session 检查完再渲染

  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthScreen notify={showToast} onEnter={() => { setAuthed(true); navigate("/chat", { replace: true }); }} />} />
        <Route path="/*" element={<RuobaiApp authed={authed} setAuthed={setAuthed} />} />
      </Routes>
      <AppToast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
