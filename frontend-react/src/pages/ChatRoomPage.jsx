import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  clearChat,
  deleteMessage,
  getMessages,
  saveMessage,
  saveUserMessage,
  speakMessage,
  streamAssistantReply,
  uploadChatImage,
} from "../lib/chat.js";
import {
  clampIntimacy,
  getRolePortraitSrc,
  getRoles,
  getRoleSnippet,
} from "../lib/roles.js";

const stickerItems = [
  { file: "01_默认温柔.png", name: "温柔" },
  { file: "02_开心明亮.png", name: "开心" },
  { file: "03_害羞微笑.png", name: "害羞" },
  { file: "04_认真倾听.png", name: "认真" },
  { file: "05_关心担忧.png", name: "担忧" },
  { file: "06_委屈小嘴.png", name: "委屈" },
  { file: "07_轻微惊讶.png", name: "惊讶" },
  { file: "08_无奈温柔.png", name: "无奈" },
  { file: "09_困倦慵懒.png", name: "困了" },
  { file: "10_生气但不凶.png", name: "生气" },
  { file: "11_撒娇期待.png", name: "撒娇" },
  { file: "12_晚安微笑.png", name: "晚安" },
];

const emojiItems = [
  "😉", "😚", "😄", "😊", "🥰", "😭", "😴", "🤍", "🙏", "👍",
  "❤️", "🌙", "✨", "🎀", "😳", "🤗", "🥺", "😌", "😼", "🤝",
  "🌸", "😅", "😜", "☀️", "🥹", "💌", "🍓", "☕", "🌷", "💭",
  "💖", "🫧", "🎵", "⭐", "🎈", "💤",
];

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeKeyword(value) {
  return String(value ?? "").trim().toLowerCase();
}

function filterMessageMatches(items, keyword) {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) {
    return [];
  }

  return (Array.isArray(items) ? items : []).filter((item) =>
    normalizeKeyword(item.content).includes(normalizedKeyword),
  );
}

function mergeSearchCorpusWithMessages(corpusItems, latestMessages) {
  const nextMap = new Map();

  (Array.isArray(corpusItems) ? corpusItems : []).forEach((item) => {
    nextMap.set(String(item.id), item);
  });

  (Array.isArray(latestMessages) ? latestMessages : []).forEach((item) => {
    nextMap.set(String(item.id), item);
  });

  return Array.from(nextMap.values()).sort((left, right) =>
    String(left.created_at || "").localeCompare(String(right.created_at || ""), "zh-CN"),
  );
}

function areMessageCollectionsEqual(leftItems, rightItems) {
  const left = Array.isArray(leftItems) ? leftItems : [];
  const right = Array.isArray(rightItems) ? rightItems : [];
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => {
    const peer = right[index];
    return (
      String(item?.id) === String(peer?.id) &&
      String(item?.content || "") === String(peer?.content || "") &&
      String(item?.message_type || "") === String(peer?.message_type || "") &&
      String(item?.media_url || "") === String(peer?.media_url || "") &&
      String(item?.created_at || "") === String(peer?.created_at || "")
    );
  });
}

function roleCompanionshipText(role) {
  const firstChatAt = role?.first_chat_at || role?.firstChatAt;
  if (!firstChatAt) {
    return "还没开始陪伴";
  }

  const startedAt = new Date(firstChatAt);
  if (Number.isNaN(startedAt.getTime())) {
    return "已经开始陪伴";
  }

  const oneDay = 24 * 60 * 60 * 1000;
  const diffDays = Math.max(
    1,
    Math.floor((Date.now() - startedAt.getTime()) / oneDay) + 1,
  );
  return `陪伴 ${diffDays} 天`;
}

function RolePortrait({ role }) {
  const [imageHidden, setImageHidden] = useState(false);
  const portraitSrc = getRolePortraitSrc(role);
  const fallback = String(role?.name ?? "R").trim().charAt(0) || "R";

  useEffect(() => {
    setImageHidden(false);
  }, [portraitSrc]);

  return (
    <div aria-hidden="true" className="chat-room-role-avatar">
      {portraitSrc && !imageHidden ? (
        <img
          alt=""
          className="chat-room-role-avatar-image"
          onError={() => setImageHidden(true)}
          src={portraitSrc}
        />
      ) : (
        <span className="chat-room-role-avatar-fallback">{fallback}</span>
      )}
    </div>
  );
}

function MessageBubble({
  actionLocked,
  deletingMessageId,
  item,
  onDelete,
  onPreviewImage,
  onSpeak,
  speakingMessageId,
}) {
  const isAssistant = item.role === "assistant";
  const timeText = formatTime(item.created_at);
  const canSpeak = isAssistant && Number(item.id) > 0;
  const isSpeaking = speakingMessageId === item.id;
  const canDelete = Number(item.id) > 0;
  const isDeleting = deletingMessageId === item.id;
  const isImageMessage =
    item.message_type === "image" && String(item.media_url || "").trim();
  const isStickerMessage =
    item.message_type === "sticker" && String(item.media_url || "").trim();

  return (
    <article
      className={isAssistant ? "chat-message-row assistant" : "chat-message-row user"}
      data-message-id={item.id}
    >
      <div className={isAssistant ? "chat-message-bubble assistant" : "chat-message-bubble user"}>
        {isImageMessage ? (
          <div className="chat-message-image-wrap">
            <button
              className="chat-message-image-btn"
              onClick={() =>
                onPreviewImage({
                  alt: item.content ? "聊天图片" : "图片消息",
                  src: item.media_url,
                })
              }
              type="button"
            >
              <img
                alt={item.content ? "聊天图片" : "图片消息"}
                className="chat-message-image"
                src={item.media_url}
              />
            </button>
          </div>
        ) : null}
        {isStickerMessage ? (
          <div className="chat-message-sticker-wrap">
            <img
              alt={item.content || "表情包"}
              className="chat-message-sticker"
              src={item.media_url}
            />
          </div>
        ) : null}
        {item.content && !isStickerMessage ? <p>{item.content}</p> : null}
        <div className="chat-message-foot">
          <span className="chat-message-time">{timeText}</span>
          <div className="chat-message-actions">
            {canSpeak ? (
              <button
                className="chat-message-tts"
                disabled={actionLocked}
                onClick={() => onSpeak(item)}
                type="button"
              >
                {isSpeaking ? "播放中..." : "播放语音"}
              </button>
            ) : null}
            {canDelete ? (
              <button
                className="chat-message-delete"
                disabled={actionLocked || deletingMessageId !== null}
                onClick={() => onDelete(item)}
                type="button"
              >
                {isDeleting ? "删除中..." : "删除"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChatRoomPage() {
  const navigate = useNavigate();
  const { roleId } = useParams();
  const [role, setRole] = useState(null);
  const [recoveryRole, setRecoveryRole] = useState(null);
  const [roleCount, setRoleCount] = useState(0);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [clearingChat, setClearingChat] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [inlineError, setInlineError] = useState("");
  const [needsAuth, setNeedsAuth] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchCorpus, setSearchCorpus] = useState([]);
  const [activeSearchKeyword, setActiveSearchKeyword] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [showRoleDetail, setShowRoleDetail] = useState(false);
  const [speakingMessageId, setSpeakingMessageId] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState(null);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState("sticker");
  const [previewImage, setPreviewImage] = useState(null);
  const listRef = useRef(null);
  const audioRef = useRef(null);
  const imageInputRef = useRef(null);
  const textareaRef = useRef(null);
  const roomRequestSeqRef = useRef(0);
  const activeRouteRoleIdRef = useRef(roleId);
  const speakRequestSeqRef = useRef(0);
  const composerEditSeqRef = useRef(0);
  const searchRequestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel?.();
    };
  }, []);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 100)}px`;
  }, [input]);

  useEffect(() => {
    if (!previewImage?.src) {
      return;
    }

    const stillExists = messages.some(
      (item) => String(item?.media_url || "") === String(previewImage.src),
    );

    if (!stillExists) {
      setPreviewImage(null);
    }
  }, [messages, previewImage]);

  function createRoomActionContext(targetRoleId = roleId) {
    return {
      requestId: roomRequestSeqRef.current,
      roleId: String(targetRoleId),
    };
  }

  function markComposerEdited() {
    composerEditSeqRef.current += 1;
  }

  function isRoomActionCurrent(context) {
    return (
      roomRequestSeqRef.current === context.requestId &&
      String(activeRouteRoleIdRef.current) === String(context.roleId)
    );
  }

  function isSpeakActionCurrent(actionContext, requestId) {
    return (
      speakRequestSeqRef.current === requestId &&
      isRoomActionCurrent(actionContext)
    );
  }

  function beginCurrentRoomActionScope() {
    roomRequestSeqRef.current += 1;
    activeRouteRoleIdRef.current = roleId;
    return createRoomActionContext(roleId);
  }

  function resetRoomTransientState(options = {}) {
    const { clearInput = true, stopAudio = true } = options;
    if (stopAudio) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      window.speechSynthesis?.cancel?.();
      setSpeakingMessageId(null);
    }

    setInlineError("");
    setClearingChat(false);
    setSending(false);
    setUploadingImage(false);
    setSearchOpen(false);
    setSearchInput("");
    searchRequestSeqRef.current += 1;
    setSearchResults([]);
    setSearchCorpus([]);
    setActiveSearchKeyword("");
    setSearchLoading(false);
    setShowRoleDetail(false);
    setDeletingMessageId(null);
    setStickerOpen(false);
    setEmojiTab("sticker");
    setPreviewImage(null);
    if (clearInput) {
      composerEditSeqRef.current += 1;
      setInput("");
    }
  }

  function syncRoomRoleState(items, requestId = roomRequestSeqRef.current) {
    if (requestId !== roomRequestSeqRef.current) {
      return null;
    }

    const fallbackRole =
      items.find((item) => Boolean(item?.is_active)) || items[0] || null;
    const currentRole = items.find(
      (item) => String(item.id) === String(roleId),
    );

    if (!currentRole) {
      resetRoomTransientState();
      setRecoveryRole(fallbackRole);
      setRoleCount(items.length);
      setRole(null);
      setMessages([]);
      setLoadError("这个角色不存在，或者已经不在你的列表里。");
      return null;
    }

    setNeedsAuth(false);
    setRecoveryRole(null);
    setRoleCount(items.length);
    setLoadError("");
    setRole(currentRole);
    return currentRole;
  }

  useEffect(() => {
    activeRouteRoleIdRef.current = roleId;
    roomRequestSeqRef.current += 1;
    resetRoomTransientState();
  }, [roleId]);

  useEffect(() => {
    if (!searchOpen) {
      return;
    }

    if (!activeSearchKeyword || activeSearchKeyword !== normalizeKeyword(searchInput)) {
      return;
    }

    const nextCorpus = mergeSearchCorpusWithMessages(searchCorpus, messages);
    if (!areMessageCollectionsEqual(nextCorpus, searchCorpus)) {
      setSearchCorpus(nextCorpus);
    }

    const nextResults = filterMessageMatches(nextCorpus, activeSearchKeyword);
    setSearchResults((current) =>
      areMessageCollectionsEqual(current, nextResults) ? current : nextResults,
    );
  }, [activeSearchKeyword, messages, searchCorpus, searchInput, searchOpen]);

  useEffect(() => {
    async function loadRoom() {
      const requestId = roomRequestSeqRef.current + 1;
      roomRequestSeqRef.current = requestId;
      setLoading(true);
      setLoadError("");
      setInlineError("");

      try {
        const rolesData = await getRoles();
        if (!rolesData?.success || !Array.isArray(rolesData.items)) {
          throw new Error(rolesData?.error || "角色列表读取失败。");
        }

        const currentRole = syncRoomRoleState(rolesData.items, requestId);
        if (!currentRole) {
          return;
        }

        const messagesData = await getMessages(roleId, 80);
        if (!messagesData?.success || !Array.isArray(messagesData.items)) {
          throw new Error(messagesData?.error || "聊天记录读取失败。");
        }

        if (roomRequestSeqRef.current === requestId) {
          setMessages(messagesData.items);
        }
      } catch (loadError) {
        if (roomRequestSeqRef.current !== requestId) {
          return;
        }

        const message =
          loadError instanceof Error ? loadError.message : "聊天室加载失败。";

        if (message.includes("401") || message.includes("登录")) {
          resetRoomTransientState();
          setNeedsAuth(true);
          setRole(null);
          setRecoveryRole(null);
          setRoleCount(0);
          setMessages([]);
          setLoadError("");
        } else {
          setLoadError(message);
        }
      } finally {
        if (roomRequestSeqRef.current === requestId) {
          setLoading(false);
        }
      }
    }

    loadRoom();
  }, [roleId]);

  useEffect(() => {
    async function refreshCurrentRoomRole() {
      const requestId = roomRequestSeqRef.current + 1;
      roomRequestSeqRef.current = requestId;
      try {
        const rolesData = await getRoles();
        if (!rolesData?.success || !Array.isArray(rolesData.items)) {
          throw new Error(rolesData?.error || "角色列表读取失败。");
        }

        const currentRole = syncRoomRoleState(rolesData.items, requestId);
        if (!currentRole || sending || uploadingImage) {
          return;
        }

        const messagesData = await getMessages(roleId, 80);
        if (!messagesData?.success || !Array.isArray(messagesData.items)) {
          throw new Error(messagesData?.error || "聊天记录读取失败。");
        }

        if (roomRequestSeqRef.current !== requestId) {
          return;
        }

        setMessages(messagesData.items);
        if (searchOpen && normalizeKeyword(searchInput)) {
          await refreshSearchResults(searchInput, { requestId, showSpinner: false });
        }
      } catch (refreshError) {
        if (roomRequestSeqRef.current !== requestId) {
          return;
        }

        const message =
          refreshError instanceof Error ? refreshError.message : "聊天室状态刷新失败。";

        if (message.includes("401") || message.includes("登录")) {
          resetRoomTransientState();
          setNeedsAuth(true);
          setRole(null);
          setRecoveryRole(null);
          setRoleCount(0);
          setMessages([]);
          setLoadError("");
        }
      }
    }

    function handleWindowFocus() {
      refreshCurrentRoomRole();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshCurrentRoomRole();
      }
    }

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [roleId, searchInput, searchOpen, sending, uploadingImage]);

  const intimacy = useMemo(
    () => clampIntimacy(role?.intimacy),
    [role?.intimacy],
  );
  const roleSnippet = useMemo(() => getRoleSnippet(role), [role]);
  const companionshipText = useMemo(() => roleCompanionshipText(role), [role]);

  function touchRoleAfterUserMessage(context = null) {
    setRole((current) => {
      if (context && !isRoomActionCurrent(context)) {
        return current;
      }

      if (!current) {
        return current;
      }

      const nextIntimacy = clampIntimacy(
        Number(current.intimacy ?? 0) + 0.5,
      );

      return {
        ...current,
        intimacy: nextIntimacy,
        first_chat_at:
          current.first_chat_at || current.firstChatAt || new Date().toISOString(),
      };
    });
  }

  async function reloadMessages(limit = 80, options = {}) {
    const { requestId = roomRequestSeqRef.current } = options;
    if (!roleId) {
      return;
    }

    const messagesData = await getMessages(roleId, limit);
    if (!messagesData?.success || !Array.isArray(messagesData.items)) {
      throw new Error(messagesData?.error || "聊天记录读取失败。");
    }

    if (roomRequestSeqRef.current !== requestId) {
      return;
    }

    setMessages(messagesData.items);
  }

  async function handleSpeak(item) {
    if (!item?.id) {
      return;
    }

    const actionContext = createRoomActionContext(roleId);
    const requestId = speakRequestSeqRef.current + 1;
    speakRequestSeqRef.current = requestId;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel?.();

    setSpeakingMessageId(item.id);
    setInlineError("");

    try {
      const data = await speakMessage(item.id);
      if (!isSpeakActionCurrent(actionContext, requestId)) {
        return;
      }
      if (!data?.success) {
        throw new Error(data?.error || "语音生成失败。");
      }

      if (data.use_browser_tts && data.text) {
        if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) {
          throw new Error("当前浏览器不支持系统语音。");
        }

        const utterance = new SpeechSynthesisUtterance(String(data.text));
        utterance.lang = "zh-CN";
        utterance.rate = 0.92;
        utterance.pitch = 1.05;
        utterance.addEventListener("end", () => {
          if (isSpeakActionCurrent(actionContext, requestId)) {
            setSpeakingMessageId(null);
          }
        }, {
          once: true,
        });
        utterance.addEventListener("error", () => {
          if (isSpeakActionCurrent(actionContext, requestId)) {
            setSpeakingMessageId(null);
          }
        }, {
          once: true,
        });
        if (!isSpeakActionCurrent(actionContext, requestId)) {
          return;
        }
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return;
      }

      if (!data.audio_url) {
        throw new Error("语音地址没有返回。");
      }

      const audio = new Audio(data.audio_url);
      audioRef.current = audio;
      audio.addEventListener("ended", () => {
        if (isSpeakActionCurrent(actionContext, requestId)) {
          setSpeakingMessageId(null);
          audioRef.current = null;
        }
      }, { once: true });
      audio.addEventListener("error", () => {
        if (isSpeakActionCurrent(actionContext, requestId)) {
          setSpeakingMessageId(null);
          audioRef.current = null;
        }
      }, { once: true });
      if (!isSpeakActionCurrent(actionContext, requestId)) {
        audio.pause();
        audioRef.current = null;
        return;
      }
      await audio.play();
    } catch (speakError) {
      if (!isSpeakActionCurrent(actionContext, requestId)) {
        return;
      }
      setSpeakingMessageId(null);
      setInlineError(
        speakError instanceof Error ? speakError.message : "语音播放失败。",
      );
    }
  }

  async function refreshSearchResults(keywordInput = searchInput, options = {}) {
    const {
      requestId = roomRequestSeqRef.current,
      searchRequestId = searchRequestSeqRef.current,
      showSpinner = true,
    } = options;
    if (!roleId) {
      return;
    }

    const keyword = normalizeKeyword(keywordInput);
    if (
      roomRequestSeqRef.current !== requestId ||
      searchRequestSeqRef.current !== searchRequestId
    ) {
      return;
    }
    if (!keyword) {
      if (
        roomRequestSeqRef.current === requestId &&
        searchRequestSeqRef.current === searchRequestId
      ) {
        setActiveSearchKeyword("");
        setSearchCorpus([]);
        setSearchResults([]);
      }
      return;
    }

    if (showSpinner) {
      setSearchLoading(true);
    }

    try {
      const messagesData = await getMessages(roleId, 200);
      if (!messagesData?.success || !Array.isArray(messagesData.items)) {
        throw new Error(messagesData?.error || "搜索聊天记录失败。");
      }

      if (
        roomRequestSeqRef.current !== requestId ||
        searchRequestSeqRef.current !== searchRequestId
      ) {
        return;
      }

      setActiveSearchKeyword(keyword);
      setSearchCorpus(messagesData.items);
      setSearchResults(filterMessageMatches(messagesData.items, keyword));
    } finally {
      if (
        showSpinner &&
        roomRequestSeqRef.current === requestId &&
        searchRequestSeqRef.current === searchRequestId
      ) {
        setSearchLoading(false);
      }
    }
  }

  async function handleSearch() {
    if (!roleId) {
      return;
    }

    const requestId = roomRequestSeqRef.current;
    const searchRequestId = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = searchRequestId;
    const keyword = normalizeKeyword(searchInput);
    if (!keyword) {
      setActiveSearchKeyword("");
      setSearchCorpus([]);
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    setInlineError("");

    try {
      await refreshSearchResults(searchInput, {
        requestId,
        searchRequestId,
        showSpinner: false,
      });
    } catch (searchError) {
      if (
        roomRequestSeqRef.current !== requestId ||
        searchRequestSeqRef.current !== searchRequestId
      ) {
        return;
      }
      setInlineError(
        searchError instanceof Error
          ? searchError.message
          : "搜索聊天记录失败。",
      );
    } finally {
      if (
        roomRequestSeqRef.current === requestId &&
        searchRequestSeqRef.current === searchRequestId
      ) {
        setSearchLoading(false);
      }
    }
  }

  function handleSearchInputChange(event) {
    searchRequestSeqRef.current += 1;
    setInlineError("");
    setActiveSearchKeyword("");
    setSearchCorpus([]);
    setSearchResults([]);
    setSearchLoading(false);
    setSearchInput(event.target.value);
  }

  function handleCloseSearch() {
    searchRequestSeqRef.current += 1;
    setSearchLoading(false);
    setSearchOpen(false);
  }

  async function handleClearChat() {
    if (!role) {
      return;
    }

    const ok = window.confirm(`确认清空和 ${role.name} 的当前聊天记录吗？`);
    if (!ok) {
      return;
    }

    setInlineError("");
    const actionContext = beginCurrentRoomActionScope();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis?.cancel?.();
    setSpeakingMessageId(null);
    setUploadingImage(false);
    setClearingChat(true);

    try {
      const data = await clearChat(role.id);
      if (!data?.success) {
        throw new Error(data?.error || "清空对话失败。");
      }

      if (!isRoomActionCurrent(actionContext)) {
        return;
      }

      setMessages([]);
      setSearchCorpus([]);
      setActiveSearchKeyword("");
      setSearchResults([]);
      setSearchInput("");
      setSearchOpen(false);
      setStickerOpen(false);
    } catch (clearError) {
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }

      setInlineError(
        clearError instanceof Error ? clearError.message : "清空对话失败。",
      );
    } finally {
      if (isRoomActionCurrent(actionContext)) {
        setClearingChat(false);
      }
    }
  }

  async function jumpToMessage(messageId) {
    handleCloseSearch();
    const requestId = roomRequestSeqRef.current;
    await reloadMessages(200, { requestId });
    if (roomRequestSeqRef.current !== requestId) {
      return;
    }

    requestAnimationFrame(() => {
      const target = listRef.current?.querySelector(
        `[data-message-id="${CSS.escape(String(messageId))}"]`,
      );
      if (!target) {
        return;
      }

      target.classList.add("search-hit");
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => target.classList.remove("search-hit"), 2200);
    });
  }

  async function handleSend(event) {
    event.preventDefault();

    const draftInput = input;
    const text = draftInput.trim();
    if (!text || sending || clearingChat || !role) {
      return;
    }

    const composeRevision = composerEditSeqRef.current;
    setSending(true);
    setInlineError("");
    setInput("");

    const optimisticUserMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    const optimisticAssistantId = `assistant-${Date.now()}`;
    let finalAssistantText = "";
    let userMessageSaved = false;
    const actionContext = createRoomActionContext(role.id);

    setMessages((current) => [
      ...current,
      optimisticUserMessage,
      {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const savedUser = await saveUserMessage(role.id, {
        role: "user",
        content: text,
      });

      if (!savedUser?.success || !savedUser.item) {
        throw new Error(savedUser?.error || "用户消息保存失败。");
      }
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      userMessageSaved = true;
      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticUserMessage.id ? savedUser.item : item,
        ),
      );
      touchRoleAfterUserMessage(actionContext);

      await streamAssistantReply(
        role.id,
        { role: "user", content: text },
        {
          onError: (message) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText = message;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: message }
                  : item,
              ),
            );
          },
          onToken: (token) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText += token;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: finalAssistantText }
                  : item,
              ),
            );
          },
        },
      );

      if (!finalAssistantText.trim()) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        finalAssistantText = "她沉默了一下，还没有回你。";
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId
              ? { ...item, content: finalAssistantText }
              : item,
          ),
        );
      }

      const savedAssistant = await saveMessage(role.id, {
        role: "assistant",
        content: finalAssistantText,
      });

      if (savedAssistant?.success && savedAssistant.item) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId ? savedAssistant.item : item,
          ),
        );
      }
    } catch (sendError) {
      const message =
        sendError instanceof Error ? sendError.message : "发送失败，请稍后再试。";
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      if (!userMessageSaved) {
        if (composerEditSeqRef.current === composeRevision) {
          setInput(draftInput);
        }
        setMessages((current) =>
          current.filter(
            (item) =>
              item.id !== optimisticUserMessage.id &&
              item.id !== optimisticAssistantId,
          ),
        );
      }
      setInlineError(message);
      if (!userMessageSaved) {
        return;
      }
      setMessages((current) =>
        current.map((item) => {
          if (item.id === optimisticAssistantId) {
            return {
              ...item,
              content: `发送失败：${message}`,
            };
          }

          return item;
        }),
      );
    } finally {
      if (isRoomActionCurrent(actionContext)) {
        setSending(false);
      }
    }
  }

  async function handleImageSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file || !role || sending || clearingChat || uploadingImage) {
      return;
    }

    setUploadingImage(true);
    setInlineError("");

    const draftInput = input;
    const text = draftInput.trim();
    const composeRevision = composerEditSeqRef.current;
    setInput("");

    const optimisticUserMessage = {
      id: `image-user-${Date.now()}`,
      role: "user",
      content: text,
      message_type: "image",
      media_url: "",
      created_at: new Date().toISOString(),
    };
    const optimisticAssistantId = `image-assistant-${Date.now()}`;
    let finalAssistantText = "";
    let userMessageSaved = false;
    const actionContext = createRoomActionContext(role.id);

    try {
      const mediaUrl = await uploadChatImage(file);
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      optimisticUserMessage.media_url = mediaUrl;

      setMessages((current) => [
        ...current,
        optimisticUserMessage,
        {
          id: optimisticAssistantId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);

      const savedUser = await saveUserMessage(role.id, {
        role: "user",
        content: text,
        message_type: "image",
        media_url: mediaUrl,
      });

      if (!savedUser?.success || !savedUser.item) {
        throw new Error(savedUser?.error || "图片消息保存失败。");
      }
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      userMessageSaved = true;

      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticUserMessage.id ? savedUser.item : item,
        ),
      );
      touchRoleAfterUserMessage(actionContext);

      await streamAssistantReply(
        role.id,
        {
          role: "user",
          content: text,
          message_type: "image",
          media_url: mediaUrl,
        },
        {
          onError: (message) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText = message;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: message }
                  : item,
              ),
            );
          },
          onToken: (token) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText += token;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: finalAssistantText }
                  : item,
              ),
            );
          },
        },
      );

      if (!finalAssistantText.trim()) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        finalAssistantText = "她看了一眼图片，暂时没有回你。";
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId
              ? { ...item, content: finalAssistantText }
              : item,
          ),
        );
      }

      const savedAssistant = await saveMessage(role.id, {
        role: "assistant",
        content: finalAssistantText,
      });

      if (savedAssistant?.success && savedAssistant.item) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId ? savedAssistant.item : item,
          ),
        );
      }
    } catch (imageError) {
      const message =
        imageError instanceof Error ? imageError.message : "图片发送失败。";
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      if (!userMessageSaved) {
        if (composerEditSeqRef.current === composeRevision) {
          setInput(draftInput);
        }
        setMessages((current) =>
          current.filter(
            (item) =>
              item.id !== optimisticUserMessage.id &&
              item.id !== optimisticAssistantId,
          ),
        );
      } else {
        setMessages((current) =>
          current.map((item) => {
            if (item.id === optimisticAssistantId) {
              return {
                ...item,
                content: `图片发送失败：${message}`,
              };
            }

            return item;
          }),
        );
      }
      setInlineError(message);
    } finally {
      if (isRoomActionCurrent(actionContext)) {
        setUploadingImage(false);
      }
    }
  }

  async function handleSendSticker(sticker) {
    if (!role || sending || clearingChat || uploadingImage) {
      return;
    }

    setSending(true);
    setStickerOpen(false);
    setInlineError("");

    const mediaUrl = `/images/xiaobai-emotions/${sticker.file}`;
    const content = `[表情:${sticker.name}]`;
    const optimisticUserMessage = {
      id: `sticker-user-${Date.now()}`,
      role: "user",
      content,
      message_type: "sticker",
      media_url: mediaUrl,
      created_at: new Date().toISOString(),
    };
    const optimisticAssistantId = `sticker-assistant-${Date.now()}`;
    let finalAssistantText = "";
    let userMessageSaved = false;
    const actionContext = createRoomActionContext(role.id);

    setMessages((current) => [
      ...current,
      optimisticUserMessage,
      {
        id: optimisticAssistantId,
        role: "assistant",
        content: "",
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const savedUser = await saveUserMessage(role.id, {
        role: "user",
        content,
        message_type: "sticker",
        media_url: mediaUrl,
      });

      if (!savedUser?.success || !savedUser.item) {
        throw new Error(savedUser?.error || "表情消息保存失败。");
      }
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      userMessageSaved = true;

      setMessages((current) =>
        current.map((item) =>
          item.id === optimisticUserMessage.id ? savedUser.item : item,
        ),
      );
      touchRoleAfterUserMessage(actionContext);

      await streamAssistantReply(
        role.id,
        {
          role: "user",
          content: `用户发了一个表情包：${sticker.name}`,
        },
        {
          onError: (message) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText = message;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: message }
                  : item,
              ),
            );
          },
          onToken: (token) => {
            if (!isRoomActionCurrent(actionContext)) {
              return;
            }
            finalAssistantText += token;
            setMessages((current) =>
              current.map((item) =>
                item.id === optimisticAssistantId
                  ? { ...item, content: finalAssistantText }
                  : item,
              ),
            );
          },
        },
      );

      if (!finalAssistantText.trim()) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        finalAssistantText = "她看见这个表情，笑了一下。";
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId
              ? { ...item, content: finalAssistantText }
              : item,
          ),
        );
      }

      const savedAssistant = await saveMessage(role.id, {
        role: "assistant",
        content: finalAssistantText,
      });

      if (savedAssistant?.success && savedAssistant.item) {
        if (!isRoomActionCurrent(actionContext)) {
          return;
        }
        setMessages((current) =>
          current.map((item) =>
            item.id === optimisticAssistantId ? savedAssistant.item : item,
          ),
        );
      }
    } catch (stickerError) {
      const message =
        stickerError instanceof Error ? stickerError.message : "表情发送失败。";
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }
      if (!userMessageSaved) {
        setMessages((current) =>
          current.filter(
            (item) =>
              item.id !== optimisticUserMessage.id &&
              item.id !== optimisticAssistantId,
          ),
        );
      } else {
        setMessages((current) =>
          current.map((item) => {
            if (item.id === optimisticAssistantId) {
              return {
                ...item,
                content: `表情发送失败：${message}`,
              };
            }

            return item;
          }),
        );
      }
      setInlineError(message);
    } finally {
      if (isRoomActionCurrent(actionContext)) {
        setSending(false);
      }
    }
  }

  async function handleDeleteMessage(item) {
    if (!item?.id) {
      return;
    }

    const ok = window.confirm("确认删除这条消息吗？");
    if (!ok) {
      return;
    }

    setDeletingMessageId(item.id);
    setInlineError("");
    const actionContext = createRoomActionContext(roleId);

    try {
      const data = await deleteMessage(item.id);
      if (!data?.success) {
        throw new Error(data?.error || "删除消息失败。");
      }

      if (!isRoomActionCurrent(actionContext)) {
        return;
      }

      setMessages((current) =>
        current.filter((message) => String(message.id) !== String(item.id)),
      );
      setSearchCorpus((current) =>
        current.filter((message) => String(message.id) !== String(item.id)),
      );
      setSearchResults((current) =>
        current.filter((message) => String(message.id) !== String(item.id)),
      );
    } catch (deleteError) {
      if (!isRoomActionCurrent(actionContext)) {
        return;
      }

      setInlineError(
        deleteError instanceof Error ? deleteError.message : "删除消息失败。",
      );
    } finally {
      if (isRoomActionCurrent(actionContext)) {
        setDeletingMessageId(null);
      }
    }
  }

  function handleAppendEmoji(emoji) {
    markComposerEdited();
    setInput((current) => `${current}${emoji}`);
    setStickerOpen(false);
  }

  function handlePreviewImage(image) {
    setPreviewImage(image);
  }

  function handleInputKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  if (loading) {
    return (
      <section className="chat-room-page">
        <div className="rb-card chat-room-feedback">
          <p>正在把她和聊天记录接回来...</p>
        </div>
      </section>
    );
  }

  if (needsAuth) {
    return (
      <section className="chat-room-page">
        <div className="rb-card chat-room-feedback">
          <p>要先登录，才能继续和她聊天。</p>
          <div className="chat-room-auth-actions">
            <button
              className="primary-link chat-room-auth-btn"
              onClick={() => navigate("/auth")}
              type="button"
            >
              去登录
            </button>
            <Link className="secondary-link chat-room-auth-btn" to="/">
              返回首页
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!role || loadError) {
    return (
      <section className="chat-room-page">
        <div className="rb-card chat-room-feedback error" role="alert">
          <p>{loadError || "聊天室暂时打不开。"}</p>
          <div className="chat-room-auth-actions">
            {recoveryRole ? (
              <Link
                className="primary-link chat-room-auth-btn"
                to={`/chat/${encodeURIComponent(recoveryRole.id)}`}
              >
                {`去和 ${recoveryRole.name} 聊天`}
              </Link>
            ) : null}
            {!recoveryRole && roleCount === 0 ? (
              <Link className="primary-link chat-room-auth-btn" to="/characters?onboard=first-role">
                去创建第一个她
              </Link>
            ) : null}
            <Link className="secondary-link chat-room-auth-btn" to="/chat">
              回到聊天列表
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="chat-room-page">
      <header className="rb-card chat-room-head">
        <div className="chat-room-head-main">
          <Link className="chat-room-back" to="/chat">
            返回
          </Link>
          <RolePortrait role={role} />
          <div className="chat-room-role-copy">
            <div className="chat-room-role-name-row">
              <h1>{role.name}</h1>
              {role.tag ? <span className="chat-room-role-tag">{role.tag}</span> : null}
            </div>
            <p className="chat-room-role-meta">{`${companionshipText} · 亲密 ${intimacy}`}</p>
            {roleSnippet ? <p className="chat-room-role-snippet">{roleSnippet}</p> : null}
          </div>
        </div>
        <div className="chat-room-head-actions">
          <button
            className="secondary-link chat-room-head-btn"
            onClick={() => setShowRoleDetail((current) => !current)}
            type="button"
          >
            {showRoleDetail ? "收起角色详情" : "角色详情"}
          </button>
          <button
            className="secondary-link chat-room-head-btn"
            onClick={() => setSearchOpen(true)}
            type="button"
          >
            搜索聊天记录
          </button>
          <button
            className="secondary-link chat-room-head-btn danger"
            disabled={sending || clearingChat || uploadingImage || deletingMessageId !== null}
            onClick={handleClearChat}
            type="button"
          >
            {clearingChat ? "清空中..." : "清空对话"}
          </button>
        </div>
      </header>

      {showRoleDetail ? (
        <div className="rb-card chat-room-detail-card">
          <div className="chat-room-detail-grid">
            <article>
              <span className="chat-room-detail-label">名字</span>
              <strong>{role.name}</strong>
            </article>
            <article>
              <span className="chat-room-detail-label">关系</span>
              <strong>{role.tag || "未设置"}</strong>
            </article>
            <article>
              <span className="chat-room-detail-label">陪伴状态</span>
              <strong>{companionshipText}</strong>
            </article>
            <article>
              <span className="chat-room-detail-label">亲密度</span>
              <strong>{intimacy}</strong>
            </article>
          </div>
          {roleSnippet ? (
            <p className="chat-room-detail-snippet">{roleSnippet}</p>
          ) : null}
        </div>
      ) : null}

      <div className="rb-card chat-room-shell">
        <div
          className="chat-room-messages"
          onClick={() => {
            if (stickerOpen) {
              setStickerOpen(false);
            }
          }}
          ref={listRef}
        >
          {messages.length === 0 ? (
            <div className="chat-room-empty">
              <p>这里还没有聊天记录。</p>
              <p>发一句话，她就会在这里开始回应你。</p>
            </div>
          ) : (
            messages.map((item) => (
              <MessageBubble
                actionLocked={sending || clearingChat || uploadingImage}
                deletingMessageId={deletingMessageId}
                item={item}
                key={item.id}
                onDelete={handleDeleteMessage}
                onPreviewImage={handlePreviewImage}
                onSpeak={handleSpeak}
                speakingMessageId={speakingMessageId}
              />
            ))
          )}
        </div>

        <form className="chat-room-composer" onSubmit={handleSend}>
          <input
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={handleImageSelected}
            ref={imageInputRef}
            type="file"
          />
          <button
            className="secondary-link chat-room-media-btn"
            disabled={sending || clearingChat || uploadingImage}
            onClick={() => imageInputRef.current?.click()}
            type="button"
          >
            {uploadingImage ? "发图中..." : "图片"}
          </button>
          <button
            className="secondary-link chat-room-media-btn"
            disabled={sending || clearingChat || uploadingImage}
            onClick={() => {
              setEmojiTab("sticker");
              setStickerOpen((current) => !current);
            }}
            type="button"
          >
            表情
          </button>
          <textarea
            className="chat-room-input"
            disabled={sending || clearingChat || uploadingImage}
            maxLength={2000}
            onChange={(event) => {
              markComposerEdited();
              setInput(event.target.value);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              clearingChat
                ? "正在清空这一段对话..."
                : uploadingImage
                ? `正在把图片发给 ${role.name}...`
                : `跟 ${role.name} 说点什么...`
            }
            ref={textareaRef}
            rows={1}
            value={input}
          />
          <button
            className="primary-link chat-room-send"
            disabled={sending || clearingChat || uploadingImage || !input.trim()}
            type="submit"
          >
            {sending ? "发送中..." : "发送"}
          </button>
        </form>

        {stickerOpen ? (
          <div className="chat-room-sticker-panel">
            <div className="chat-room-sticker-head">
              <strong>{`${role.name}表情`}</strong>
              <span>点一下就发出去</span>
            </div>
            <div className="chat-room-sticker-tabs">
              <button
                className={emojiTab === "sticker" ? "chat-room-sticker-tab active" : "chat-room-sticker-tab"}
                onClick={() => setEmojiTab("sticker")}
                type="button"
              >
                若白表情
              </button>
              <button
                className={emojiTab === "emoji" ? "chat-room-sticker-tab active" : "chat-room-sticker-tab"}
                onClick={() => setEmojiTab("emoji")}
                type="button"
              >
                通用 Emoji
              </button>
            </div>
            {emojiTab === "sticker" ? (
              <div className="chat-room-sticker-grid">
                {stickerItems.map((sticker) => (
                  <button
                    className="chat-room-sticker-item"
                    key={sticker.file}
                    onClick={() => handleSendSticker(sticker)}
                    type="button"
                  >
                    <img
                      alt={sticker.name}
                      src={`/images/xiaobai-emotions/${sticker.file}`}
                    />
                  </button>
                ))}
              </div>
            ) : (
              <div className="chat-room-emoji-grid">
                {emojiItems.map((emoji) => (
                  <button
                    className="chat-room-emoji-item"
                    key={emoji}
                    onClick={() => handleAppendEmoji(emoji)}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {inlineError ? (
          <div className="chat-room-inline-error" role="alert">
            {inlineError}
          </div>
        ) : null}
      </div>

      {searchOpen ? (
        <div
          className="chat-room-search-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseSearch();
            }
          }}
        >
          <div className="rb-card chat-room-search-panel">
            <div className="chat-room-search-head">
              <h2>搜索聊天记录</h2>
              <button
                className="chat-room-search-close"
                onClick={handleCloseSearch}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="chat-room-search-bar">
              <input
                className="form-input"
                onChange={handleSearchInputChange}
                placeholder="输入关键词"
                type="text"
                value={searchInput}
              />
              <button
                className="primary-link chat-room-search-go"
                onClick={handleSearch}
                type="button"
              >
                {searchLoading ? "搜索中..." : "搜索"}
              </button>
            </div>

            <div className="chat-room-search-summary">
              {searchLoading
                ? "正在搜索..."
                : searchInput.trim()
                  ? `共找到 ${searchResults.length} 条匹配`
                  : "输入关键词开始搜索"}
            </div>

            <div className="chat-room-search-results">
              {!searchLoading && searchInput.trim() && searchResults.length === 0 ? (
                <div className="chat-room-search-empty">没有找到匹配内容。</div>
              ) : null}

              {searchResults.map((item) => (
                <button
                  className="chat-room-search-item"
                  key={item.id}
                  onClick={() => jumpToMessage(item.id)}
                  type="button"
                >
                  <div className="chat-room-search-item-meta">
                    <span>{item.role === "assistant" ? "她" : "你"}</span>
                    <span>{formatTime(item.created_at)}</span>
                  </div>
                  <div className="chat-room-search-item-text">
                    {item.content || "空消息"}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {previewImage ? (
        <div
          className="moments-modal-overlay image-preview"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setPreviewImage(null);
            }
          }}
        >
          <div className="rb-card moments-image-preview-card">
            <div className="moments-modal-head">
              <h2>图片预览</h2>
              <button
                className="moments-modal-close"
                onClick={() => setPreviewImage(null)}
                type="button"
              >
                关闭
              </button>
            </div>
            <div className="moments-image-preview-body">
              <img alt={previewImage.alt || "聊天图片"} src={previewImage.src} />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
