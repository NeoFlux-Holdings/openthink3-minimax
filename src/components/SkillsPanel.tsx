import React, { useEffect, useReducer, useRef, useState } from 'react';
import { X, Search, BookOpen, StickyNote, Zap, Gauge, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  SKILLS,
  type Skill,
  type SkillId,
  isSkillEnabled,
  setSkillEnabled,
} from '../lib/skills';

type PanelState = {
  activeId: SkillId | null;
};

type PanelAction = { type: 'OPEN'; id: SkillId } | { type: 'CLOSE' };

const initialPanel: PanelState = { activeId: null };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'OPEN':
      return { activeId: action.id };
    case 'CLOSE':
      return { activeId: null };
  }
}

const iconForSkill = (id: SkillId) => {
  switch (id) {
    case 'gbrain-search': return <Search size={16} />;
    case 'gbrain-think': return <BookOpen size={16} />;
    case 'gbrain-capture': return <StickyNote size={16} />;
    case 'gstack-run': return <Zap size={16} />;
    case 'gbrain-evals': return <Gauge size={16} />;
  }
};

const accentForSkill = (id: SkillId) => {
  switch (id) {
    case 'gbrain-search': return 'var(--accent-primary)';
    case 'gbrain-think': return '#8B5CF6';
    case 'gbrain-capture': return 'var(--accent-secondary)';
    case 'gstack-run': return '#F59E0B';
    case 'gbrain-evals': return '#3B82F6';
  }
};

const SkillsPanel: React.FC = () => {
  const [state, dispatch] = useReducer(panelReducer, initialPanel);
  const [, setTick] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const { activeId } = state;
  const open = activeId !== null;
  const activeSkill = activeId ? SKILLS.find((s) => s.id === activeId) : null;

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('storage', bump);
    return () => window.removeEventListener('storage', bump);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const handleToggle = (skill: Skill) => {
    setSkillEnabled(skill.id, !isSkillEnabled(skill.id));
    setTick((t) => t + 1);
  };

  const handleOpenInfo = (skill: Skill) => {
    dispatch({ type: 'OPEN', id: skill.id });
  };

  const handleClose = () => dispatch({ type: 'CLOSE' });

  return (
    <div className="skills-panel">
      <div className="skills-list">
        {SKILLS.map((skill) => {
          const enabled = isSkillEnabled(skill.id);
          return (
            <article
              key={skill.id}
              className="skill-card"
              data-enabled={enabled}
            >
              <div className="skill-card__head">
                <div
                  className="icon-color-tile"
                  style={{
                    background: enabled ? `${accentForSkill(skill.id)}15` : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${enabled ? `${accentForSkill(skill.id)}30` : 'var(--border-subtle)'}`,
                    color: enabled ? accentForSkill(skill.id) : 'var(--text-tertiary)',
                  }}
                >
                  {iconForSkill(skill.id)}
                </div>

                <div className="skill-card__head-text">
                  <div className="row-flex-gap-6">
                    <h4 className="skill-card__title">{skill.name}</h4>
                    {skill.premium && <span className="skill-card__badge skill-card__badge--pro">PRO</span>}
                    <span
                      className="skill-card__badge"
                      style={{
                        color: '#10B981',
                        background: 'rgba(16,185,129,0.1)',
                        border: '1px solid rgba(16,185,129,0.2)',
                      }}
                    >
                      <span className="status-dot status-dot--live" />
                      Native
                    </span>
                  </div>
                  <p className="skill-card__desc">{skill.description}</p>
                  <div className="skill-card__keywords">
                    {skill.triggerKeywords.map((kw) => (
                      <code key={kw} className="skill-card__keyword">{kw}</code>
                    ))}
                  </div>
                </div>

                <div className="skill-card__controls">
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => handleOpenInfo(skill)}
                    aria-label={`Details for ${skill.name}`}
                  >
                    Details
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(skill)}
                    className="skill-card__toggle"
                    data-on={enabled}
                    aria-label={enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
                    aria-pressed={enabled}
                  >
                    {enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                  </button>
                </div>
              </div>

              <div className="status-bar skill-card__bar">
                <div className="status-bar__group">
                  <span className="status-bar__value">{skill.workerEndpoint}</span>
                </div>
                <span className="status-bar__sep">·</span>
                <div className="status-bar__group">
                  <span>Triggers</span>
                  <span className="status-bar__value">{skill.triggerKeywords.length}</span>
                </div>
                <span className="status-bar__sep">·</span>
                <div className="status-bar__group">
                  <span>State</span>
                  <span className="status-bar__value">{enabled ? 'ON' : 'OFF'}</span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {open && activeSkill && (
        <dialog
          ref={dialogRef}
          className="skill-modal"
          aria-label={`Details for ${activeSkill.name}`}
          onClose={handleClose}
        >
          <div className="skill-modal__panel">
            <header className="skill-modal__head">
              <div className="row-flex-gap-6">
                <div
                  className="icon-color-tile"
                  style={{
                    background: `${accentForSkill(activeSkill.id)}15`,
                    border: `1px solid ${accentForSkill(activeSkill.id)}30`,
                    color: accentForSkill(activeSkill.id),
                  }}
                >
                  {iconForSkill(activeSkill.id)}
                </div>
                <div>
                  <h3 className="skill-modal__title">{activeSkill.name}</h3>
                  <p className="skill-modal__sub">Native Cloudflare Worker skill</p>
                </div>
              </div>
              <button
                type="button"
                className="home-icon-btn"
                onClick={handleClose}
                aria-label="Close details panel"
              >
                <X size={16} />
              </button>
            </header>

            <div className="skill-modal__body">
              <p className="skill-modal__desc">{activeSkill.description}</p>

              <div className="skill-modal__field">
                <span className="skill-modal__label">Worker endpoint</span>
                <code className="skill-modal__endpoint">{activeSkill.workerEndpoint}</code>
              </div>

              <div className="skill-modal__field">
                <span className="skill-modal__label">Trigger keywords</span>
                <div className="skill-card__keywords">
                  {activeSkill.triggerKeywords.map((kw) => (
                    <code key={kw} className="skill-card__keyword">{kw}</code>
                  ))}
                </div>
              </div>
            </div>

            <footer className="skill-modal__foot">
              <button type="button" className="btn-solid btn-solid--accent" onClick={handleClose}>
                Close
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </div>
  );
};

export default SkillsPanel;
