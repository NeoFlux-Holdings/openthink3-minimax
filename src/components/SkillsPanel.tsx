import React, { useEffect, useReducer, useRef, useState } from 'react';
import { X, Save, Search, BookOpen, StickyNote, Zap, Gauge, BellRing, ToggleLeft, ToggleRight } from 'lucide-react';
import {
  SKILLS,
  type Skill,
  type SkillId,
  isSkillEnabled,
  setSkillEnabled,
  getSkillConfig,
  setSkillConfig,
  isSkillConfigured,
} from '../lib/skills';

type PanelState = {
  activeId: SkillId | null;
  configDraft: Record<string, string>;
  savedAt: number;
};

type PanelAction =
  | { type: 'OPEN'; id: SkillId; config: Record<string, string> }
  | { type: 'CLOSE' }
  | { type: 'PATCH_FIELD'; key: string; value: string }
  | { type: 'SAVED' };

const initialPanel: PanelState = { activeId: null, configDraft: {}, savedAt: 0 };

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'OPEN':
      return { ...state, activeId: action.id, configDraft: { ...action.config } };
    case 'CLOSE':
      return { ...state, activeId: null, configDraft: {} };
    case 'PATCH_FIELD':
      return { ...state, configDraft: { ...state.configDraft, [action.key]: action.value } };
    case 'SAVED':
      return { ...state, savedAt: Date.now() };
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
  const { activeId, configDraft, savedAt } = state;
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

  const needsConfiguration = SKILLS.filter(
    (s) => s.requiresConfig && !isSkillConfigured(s.id)
  );

  const handleToggle = (skill: Skill) => {
    setSkillEnabled(skill.id, !isSkillEnabled(skill.id));
    setTick((t) => t + 1);
  };

  const handleOpenConfig = (skill: Skill) => {
    dispatch({ type: 'OPEN', id: skill.id, config: getSkillConfig(skill.id) });
  };

  const handleSaveConfig = (skill: Skill) => {
    const sanitized: Record<string, string> = {};
    for (const field of skill.configFields) {
      sanitized[field.key] = (configDraft[field.key] ?? '').trim();
    }
    setSkillConfig(skill.id, sanitized);
    dispatch({ type: 'SAVED' });
    setTimeout(() => {
      dispatch({ type: 'CLOSE' });
      setTick((t) => t + 1);
    }, 600);
  };

  const handleClose = () => dispatch({ type: 'CLOSE' });
  const justSaved = savedAt > 0 && Date.now() - savedAt < 700;

  return (
    <div className="skills-panel">
      {needsConfiguration.length > 0 && (
        <div className="skills-banner">
          <BellRing size={14} className="skills-banner__icon" />
          <span>
            Some skills need configuration. Click <strong>Configure</strong> to set them up.
          </span>
        </div>
      )}

      <div className="skills-list">
        {SKILLS.map((skill) => {
          const enabled = isSkillEnabled(skill.id);
          const configured = isSkillConfigured(skill.id);
          return (
            <article
              key={skill.id}
              className="skill-card"
              data-enabled={enabled}
              data-configured={configured}
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
                        color: configured ? '#10B981' : '#F59E0B',
                        background: configured ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${configured ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)'}`,
                      }}
                    >
                      <span className={`status-dot ${configured ? 'status-dot--live' : 'status-dot--warn'}`} />
                      {configured ? 'Ready' : 'Setup needed'}
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
                    onClick={() => handleOpenConfig(skill)}
                    disabled={!skill.requiresConfig}
                    aria-label={`Configure ${skill.name}`}
                  >
                    Configure
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
          aria-label={`Configure ${activeSkill.name}`}
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
                  <p className="skill-modal__sub">Set credentials and routing for this skill</p>
                </div>
              </div>
              <button
                type="button"
                className="home-icon-btn"
                onClick={handleClose}
                aria-label="Close configure panel"
              >
                <X size={16} />
              </button>
            </header>

            <div className="skill-modal__body">
              {activeSkill.configFields.length === 0 ? (
                <p className="skill-modal__empty">This skill requires no configuration.</p>
              ) : (
                activeSkill.configFields.map((field) => (
                  <div key={field.key} className="skill-modal__field">
                    <label className="skill-modal__label" htmlFor={`skill-${activeSkill.id}-${field.key}`}>
                      {field.label}
                      {field.required && <span className="skill-modal__required"> *</span>}
                    </label>
                    <input
                      id={`skill-${activeSkill.id}-${field.key}`}
                      type={field.type}
                      className="input-field"
                      value={configDraft[field.key] ?? ''}
                      onChange={(e) => dispatch({ type: 'PATCH_FIELD', key: field.key, value: e.target.value })}
                      placeholder={field.placeholder}
                      autoComplete="off"
                      aria-label={field.label}
                    />
                  </div>
                ))
              )}
            </div>

            <footer className="skill-modal__foot">
              <button type="button" className="btn-ghost-sm" onClick={handleClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-solid btn-solid--accent"
                onClick={() => handleSaveConfig(activeSkill)}
                disabled={justSaved}
              >
                {justSaved ? 'Saved' : (<><Save size={12} /> Save</>)}
              </button>
            </footer>
          </div>
        </dialog>
      )}
    </div>
  );
};

export default SkillsPanel;
