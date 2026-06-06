import React from "react";
import { Icon } from "../store.jsx";
/* 引导问答 — 「让她更懂你」逐题流程,答完转成该角色的记忆
   每个角色各有一份;入口在「我的」(主陪伴)和每个角色详情页。
   角色扮演养很多个角色时,引导藏在各自详情里,互不打扰、可无限扩展。 */
const { useState: useStateOb } = React;

const OB_QS = [
  { key: "怎么称呼你", cat: "称呼", q: "我该怎么称呼你?", ph: "你想让我怎么叫你", chips: [], pin: true },
  { key: "每天在忙的事", cat: "日常", q: "你现在,每天大多在忙些什么?", ph: "工作、学习、还是在歇着…", chips: [] },
  { key: "搁在心里的事", cat: "心事", q: "最近有没有一件事,一直搁在心里?", ph: "说出来,我替你记着。", chips: [], pin: true },
  { key: "别这样对我", cat: "雷区", q: "你最不喜欢别人怎么对你?", ph: "踩了这些,我会避开。", chips: ["别讲大道理", "别催我", "别敷衍", "别忽冷忽热"] },
  { key: "想要的陪伴", cat: "喜好", q: "累的时候,你更希望我怎么陪你?", ph: "", chips: ["安静听着就好", "抱抱我", "陪我说说话", "帮我出主意"] },
  { key: "想让我记得的", cat: "我们之间", q: "有什么,是你希望我一直记得的?", ph: "一句话、一个约定,都行。", chips: [], pin: true },
];

function OnboardingFlow({ agent, onClose, onComplete, onGoMemory }) {
  const [phase, setPhase] = useStateOb("intro"); // intro | ask | done
  const [step, setStep] = useStateOb(0);
  const [answers, setAnswers] = useStateOb({});
  const [savedCount, setSavedCount] = useStateOb(0);

  const cur = OB_QS[step];
  const val = answers[step] || "";
  const setVal = (v) => setAnswers((a) => ({ ...a, [step]: v }));
  const addChip = (c) => setVal(val ? (val.includes(c) ? val : val + " · " + c) : c);
  const isLast = step === OB_QS.length - 1;

  const finish = () => {
    const mems = OB_QS.map((q, i) => {
      const text = (answers[i] || "").trim();
      return text ? { tag: q.key, category: q.cat, content: text, isImportant: !!q.pin } : null;
    }).filter(Boolean);
    setSavedCount(mems.length);
    onComplete(mems);
    setPhase("done");
  };
  const next = () => { if (isLast) finish(); else setStep(step + 1); };
  const back = () => { if (step > 0) setStep(step - 1); };

  return (
    <div className="sheet-mask" onClick={onClose}>
      <div className="sheet ob-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />

        {phase === "intro" && (
          <div className="ob-intro">
            <div className="ob-av-big"><img src={agent.avatar} alt="" /><span className="ob-av-glow" /></div>
            <div className="ob-intro-t serif">让{agent.name}更懂你</div>
            <div className="ob-intro-s">下面 6 个问题,是{agent.name}想问你的。<br/>答多少都行,跳过也没关系 —— 你说的,她会一条条记下来。</div>
            <div className="ob-intro-foot">
              <button className="pill pill-ghost grow" onClick={onClose}>下次吧</button>
              <button className="pill pill-primary grow" onClick={() => setPhase("ask")}><Icon name="heartFill" style={{ width: 14, height: 14 }} /> 开始</button>
            </div>
          </div>
        )}

        {phase === "ask" && (
          <>
            <div className="ob-head">
              <button className="ob-back" onClick={step === 0 ? onClose : back}><Icon name="back" /></button>
              <div className="ob-dots">{OB_QS.map((_, i) => <span key={i} className={"ob-dot" + (i === step ? " on" : i < step ? " done" : "")} />)}</div>
              <button className="ob-skip" onClick={next}>{isLast ? "完成" : "跳过"}</button>
            </div>
            <div className="ob-body">
              <div className="ob-count">{step + 1} / {OB_QS.length} · {agent.name}想问</div>
              <div className="ob-q serif">{cur.q}</div>
              <textarea className="fld area ob-input" autoFocus value={val} onChange={(e) => setVal(e.target.value)} placeholder={cur.ph} />
              {cur.chips.length > 0 && (
                <div className="ob-chips">
                  {cur.chips.map((c) => <button key={c} className={"ob-chip" + (val.includes(c) ? " on" : "")} onClick={() => addChip(c)}>{c}</button>)}
                </div>
              )}
            </div>
            <div className="sheet-foot">
              <button className="pill pill-primary grow" onClick={next}>
                {isLast ? <><Icon name="check" /> 让她记住这些</> : "下一个"}
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <div className="ob-intro">
            <div className="ob-av-big"><img src={agent.avatar} alt="" /><span className="ob-av-glow" /></div>
            <div className="ob-intro-t serif">{agent.name}记住了</div>
            <div className="ob-done-num">{savedCount}<span> 件关于你的事</span></div>
            <div className="ob-intro-s">这些已经存进{agent.name}的记忆里。<br/>以后她会带着这些,慢慢更懂你。</div>
            <div className="ob-intro-foot">
              <button className="pill pill-ghost grow" onClick={onClose}>好</button>
              <button className="pill pill-primary grow" onClick={() => { onClose(); onGoMemory && onGoMemory(); }}><Icon name="book" /> 去看看她记的</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export { OnboardingFlow };
