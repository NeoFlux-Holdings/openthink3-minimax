import React, { useEffect, useReducer, useRef, useState } from 'react';
import { X, Save, Puzzle, Brain, Zap, Server, BookOpen, ToggleLeft, ToggleRight, Plus, Trash2, FileCode2 } from 'lucide-react';
import {
  PLUGINS,
  isPluginEnabled,
  setPluginEnabled,
  getPluginConfig,
  setPluginConfig,
  isPluginConfigured,
  listUserPlugins,
  addUserPlugin,
  removeUserPlugin,
  scanUserPlugins,
  type OpenThinkPlugin,
  type PluginId,
  type UserPlugin,
} from '../lib/plugins';

type PanelState = {
  configId: PluginId | null;
  configDraft: Record<string, string>;
  savedAt: number;
  addUserOpen: boolean;
  userDraft: { id: string; path: string; name: string; description: string; version: string };
};

type PanelAction =
  | { type: 'OPEN_CONFIG'; id: PluginId; config: Record<string, string> }
  | { type: 'CLOSE_CONFIG' }
  | { type: 'PATCH_FIELD'; key: string; value: string }
  | { type: 'SAVED' }
  | { type: 'OPEN_ADD_USER' }
  | { type: 'CLOSE_ADD_USER' }
  | { type: 'PATCH_USER'; patch: Partial<PanelState['userDraft']> };

const initialPanel: PanelState = {
  configId: null,
  configDraft: {},
  savedAt: 0,
  addUserOpen: false,
  userDraft: { id: '', path: '', name: '', description: '', version: '0.1.0' },
};

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'OPEN_CONFIG':
      return { ...state, configId: action.id, configDraft: { ...action.config } };
    case 'CLOSE_CONFIG':
      return { ...state, configId: null, configDraft: {} };
    case 'PATCH_FIELD':
      return { ...state, configDraft: { ...state.configDraft, [action.key]: action.value } };
    case 'SAVED':
      return { ...state, savedAt: Date.now() };
    case 'OPEN_ADD_USER':
      return { ...state, addUserOpen: true };
    case 'CLOSE_ADD_USER':
      return { ...state, addUserOpen: false, userDraft: { id: '', path: '', name: '', description: '', version: '0.1.0' } };
    case 'PATCH_USER':
      return { ...state, userDraft: { ...state.userDraft, ...action.patch } };
  }
}

const iconForPlugin = (id: PluginId) => {
  switch (id) {
    case 'gbrain': return <Brain size={16} />;
    case 'gstack': return <Zap size={16} />;
    case 'exe-dev': return <Server size={16} />;
    case 'deepwiki': return <BookOpen size={16} />;
  }
};

const accentForPlugin = (id: PluginId) => {
  switch (id) {
    case 'gbrain': return '#8B5CF6';
    case 'gstack': return '#F59E0B';
    case 'exe-dev': return '#3B82F6';
    case 'deepwiki': return '#10B981';
  }
};

type PluginCardProps = {
  plugin: OpenThinkPlugin;
  enabled: boolean;
  configured: boolean;
  onToggle: (p: OpenThinkPlugin) => void;
  onConfigure: (p: OpenThinkPlugin) => void;
};

const PluginCard: React.FC<PluginCardProps> = ({ plugin, enabled, configured, onToggle, onConfigure }) => (
  <article
    className="plugin-card"
    data-enabled={enabled}
    data-configured={configured}
  >
    <div className="plugin-card__head">
      <div
        className="icon-color-tile"
        style={{
          background: enabled ? `${accentForPlugin(plugin.id)}15` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${enabled ? `${accentForPlugin(plugin.id)}30` : 'var(--border-subtle)'}`,
          color: enabled ? accentForPlugin(plugin.id) : 'var(--text-tertiary)',
        }}
      >
        {iconForPlugin(plugin.id)}
      </div>
      <div className="plugin-card__head-text">
        <div className="row-flex-gap-6 plugin-card__title-row">
          <h4 className="plugin-card__title">{plugin.name}</h4>
          <code className="plugin-card__version">v{plugin.version}</code>
          {plugin.premium && <span className="plugin-card__badge plugin-card__badge--premium">PREMIUM</span>}
          <span
            className="plugin-card__badge"
            data-state={enabled ? (configured ? 'active' : 'needs-config') : 'off'}
          >
            <span className={`status-dot ${enabled ? (configured ? 'status-dot--live' : 'status-dot--warn') : 'status-dot--off'}`} />
            {!enabled ? 'Off' : configured ? 'Active' : 'Needs config'}
          </span>
        </div>
        <p className="plugin-card__desc">{plugin.description}</p>
        <div className="plugin-card__hooks">
          {plugin.hooks.length === 0 ? (
            <span className="plugin-card__hook plugin-card__hook--empty">no hooks</span>
          ) : (
            plugin.hooks.map((hook, idx) => (
              <code key={`${hook.type}-${hook.handler}-${idx}`} className="plugin-card__hook">
                {hook.type} · {hook.handler}
              </code>
            ))
          )}
        </div>
      </div>
      <div className="plugin-card__controls">
        <button
          type="button"
          className="btn-ghost-sm"
          onClick={() => onConfigure(plugin)}
          disabled={!plugin.requiresConfig}
          aria-label={`Configure ${plugin.name}`}
        >
          Configure
        </button>
        <button
          type="button"
          onClick={() => onToggle(plugin)}
          className="plugin-card__toggle"
          data-on={enabled}
          aria-label={enabled ? `Disable ${plugin.name}` : `Enable ${plugin.name}`}
          aria-pressed={enabled}
        >
          {enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
        </button>
      </div>
    </div>
    <div className="status-bar plugin-card__bar">
      <div className="status-bar__group">
        <span>Hooks</span>
        <span className="status-bar__value">{plugin.hooks.length}</span>
      </div>
      <span className="status-bar__sep">·</span>
      <div className="status-bar__group">
        <span>Tools</span>
        <span className="status-bar__value">{plugin.tools.length}</span>
      </div>
      <span className="status-bar__sep">·</span>
      <div className="status-bar__group">
        <span>State</span>
        <span className="status-bar__value">{enabled ? 'ON' : 'OFF'}</span>
      </div>
      <span className="status-bar__sep">·</span>
      <div className="status-bar__group">
        <span>id</span>
        <span className="status-bar__value">{plugin.id}</span>
      </div>
    </div>
  </article>
);

type UserPluginCardProps = {
  plugin: UserPlugin;
  onRemove: (id: string) => void;
};

const UserPluginCard: React.FC<UserPluginCardProps> = ({ plugin, onRemove }) => (
  <article className="plugin-card plugin-card--user" data-enabled="true">
    <div className="plugin-card__head">
      <div
        className="icon-color-tile"
        style={{
          background: 'rgba(236,72,153,0.1)',
          border: '1px solid rgba(236,72,153,0.25)',
          color: '#EC4899',
        }}
      >
        <FileCode2 size={16} />
      </div>
      <div className="plugin-card__head-text">
        <div className="row-flex-gap-6 plugin-card__title-row">
          <h4 className="plugin-card__title">{plugin.name}</h4>
          <code className="plugin-card__version">v{plugin.version}</code>
          <span className="plugin-card__badge plugin-card__badge--user">USER</span>
        </div>
        <p className="plugin-card__desc">{plugin.description || 'User-installed plugin from ~/.opencode/plugins/'}</p>
        <code className="plugin-card__path">{plugin.path}</code>
      </div>
      <div className="plugin-card__controls">
        <button
          type="button"
          className="btn-ghost-sm"
          onClick={() => onRemove(plugin.id)}
          aria-label={`Remove ${plugin.name}`}
        >
          <Trash2 size={12} /> Remove
        </button>
      </div>
    </div>
  </article>
);

type ConfigureModalProps = {
  plugin: OpenThinkPlugin;
  configDraft: Record<string, string>;
  justSaved: boolean;
  onPatchField: (key: string, value: string) => void;
  onSave: (plugin: OpenThinkPlugin) => void;
  onClose: () => void;
};

const ConfigureModal: React.FC<ConfigureModalProps> = ({ plugin, configDraft, justSaved, onPatchField, onSave, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    return () => { if (el.open) el.close(); };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="plugin-modal"
      aria-label={`Configure ${plugin.name}`}
      onClose={onClose}
    >
      <div className="plugin-modal__panel">
        <header className="plugin-modal__head">
          <div className="row-flex-gap-6">
            <div
              className="icon-color-tile"
              style={{
                background: `${accentForPlugin(plugin.id)}15`,
                border: `1px solid ${accentForPlugin(plugin.id)}30`,
                color: accentForPlugin(plugin.id),
              }}
            >
              {iconForPlugin(plugin.id)}
            </div>
            <div>
              <h3 className="plugin-modal__title">{plugin.name}</h3>
              <p className="plugin-modal__sub">Plugin config · {plugin.id}</p>
            </div>
          </div>
          <button
            type="button"
            className="home-icon-btn"
            onClick={onClose}
            aria-label="Close configure panel"
          >
            <X size={16} />
          </button>
        </header>
        <div className="plugin-modal__body">
          {plugin.configFields.length === 0 ? (
            <p className="plugin-modal__empty">This plugin requires no configuration.</p>
          ) : (
            plugin.configFields.map((field) => (
              <div key={field.key} className="plugin-modal__field">
                <label className="plugin-modal__label" htmlFor={`plugin-${plugin.id}-${field.key}`}>
                  {field.label}
                  {field.required && <span className="plugin-modal__required"> *</span>}
                </label>
                <input
                  id={`plugin-${plugin.id}-${field.key}`}
                  type={field.type === 'token' ? 'password' : 'text'}
                  className="input-field"
                  value={configDraft[field.key] ?? ''}
                  onChange={(e) => onPatchField(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  aria-label={field.label}
                />
              </div>
            ))
          )}
        </div>
        <footer className="plugin-modal__foot">
          <button type="button" className="btn-ghost-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-solid btn-solid--accent"
            onClick={() => onSave(plugin)}
            disabled={justSaved}
          >
            {justSaved ? 'Saved' : (<><Save size={12} /> Save</>)}
          </button>
        </footer>
      </div>
    </dialog>
  );
};

type AddUserPluginModalProps = {
  draft: PanelState['userDraft'];
  onPatch: (patch: Partial<PanelState['userDraft']>) => void;
  onSubmit: () => void;
  onClose: () => void;
};

const AddUserPluginModal: React.FC<AddUserPluginModalProps> = ({ draft, onPatch, onSubmit, onClose }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (!el.open) el.showModal();
    return () => { if (el.open) el.close(); };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="plugin-modal"
      aria-label="Add custom plugin"
      onClose={onClose}
    >
      <div className="plugin-modal__panel">
        <header className="plugin-modal__head">
          <div className="row-flex-gap-6">
            <div
              className="icon-color-tile"
              style={{
                background: 'rgba(236,72,153,0.1)',
                border: '1px solid rgba(236,72,153,0.25)',
                color: '#EC4899',
              }}
            >
              <FileCode2 size={16} />
            </div>
            <div>
              <h3 className="plugin-modal__title">Add custom plugin</h3>
              <p className="plugin-modal__sub">~/.opencode/plugins/&lt;id&gt;.ts</p>
            </div>
          </div>
          <button
            type="button"
            className="home-icon-btn"
            onClick={onClose}
            aria-label="Close add plugin"
          >
            <X size={16} />
          </button>
        </header>
        <div className="plugin-modal__body">
          <div className="plugin-modal__field">
            <label className="plugin-modal__label" htmlFor="user-plugin-id">Plugin id *</label>
            <input
              id="user-plugin-id"
              type="text"
              className="input-field"
              value={draft.id}
              onChange={(e) => onPatch({ id: e.target.value })}
              placeholder="my-plugin"
              autoComplete="off"
            />
          </div>
          <div className="plugin-modal__field">
            <label className="plugin-modal__label" htmlFor="user-plugin-path">File path *</label>
            <input
              id="user-plugin-path"
              type="text"
              className="input-field"
              value={draft.path}
              onChange={(e) => onPatch({ path: e.target.value })}
              placeholder="~/.opencode/plugins/my-plugin.ts"
              autoComplete="off"
            />
          </div>
          <div className="plugin-modal__field">
            <label className="plugin-modal__label" htmlFor="user-plugin-name">Display name</label>
            <input
              id="user-plugin-name"
              type="text"
              className="input-field"
              value={draft.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              placeholder="My Plugin"
              autoComplete="off"
            />
          </div>
          <div className="plugin-modal__field">
            <label className="plugin-modal__label" htmlFor="user-plugin-version">Version</label>
            <input
              id="user-plugin-version"
              type="text"
              className="input-field"
              value={draft.version}
              onChange={(e) => onPatch({ version: e.target.value })}
              placeholder="0.1.0"
              autoComplete="off"
            />
          </div>
          <div className="plugin-modal__field">
            <label className="plugin-modal__label" htmlFor="user-plugin-description">Description</label>
            <input
              id="user-plugin-description"
              type="text"
              className="input-field"
              value={draft.description}
              onChange={(e) => onPatch({ description: e.target.value })}
              placeholder="What does this plugin do?"
              autoComplete="off"
            />
          </div>
        </div>
        <footer className="plugin-modal__foot">
          <button type="button" className="btn-ghost-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-solid btn-solid--accent"
            onClick={onSubmit}
            disabled={!draft.id.trim() || !draft.path.trim()}
          >
            <Plus size={12} /> Register
          </button>
        </footer>
      </div>
    </dialog>
  );
};

const PluginManagerPanel: React.FC = () => {
  const [state, dispatch] = useReducer(panelReducer, initialPanel);
  const [, setTick] = useState(0);
  const [userPlugins, setUserPluginsState] = useState<UserPlugin[]>([]);
  const [scannerNote, setScannerNote] = useState<string>('Scanner idle');
  const { configId, configDraft, savedAt, addUserOpen, userDraft } = state;
  const configOpen = configId !== null;
  const activePlugin = configId ? PLUGINS.find((p) => p.id === configId) : null;

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('storage', bump);
    return () => window.removeEventListener('storage', bump);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const found = await scanUserPlugins();
      if (!cancelled) {
        setUserPluginsState(found);
        setScannerNote(`Scanned ${found.length} user-installed plugins from ~/.opencode/plugins/`);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleToggle = (plugin: OpenThinkPlugin) => {
    setPluginEnabled(plugin.id, !isPluginEnabled(plugin.id));
    setTick((t) => t + 1);
  };

  const handleOpenConfig = (plugin: OpenThinkPlugin) => {
    dispatch({ type: 'OPEN_CONFIG', id: plugin.id, config: getPluginConfig(plugin.id) });
  };

  const handleSaveConfig = (plugin: OpenThinkPlugin) => {
    const sanitized: Record<string, string> = {};
    for (const field of plugin.configFields) {
      sanitized[field.key] = (configDraft[field.key] ?? '').trim();
    }
    setPluginConfig(plugin.id, sanitized);
    dispatch({ type: 'SAVED' });
    setTimeout(() => {
      dispatch({ type: 'CLOSE_CONFIG' });
      setTick((t) => t + 1);
    }, 600);
  };

  const handleClose = () => dispatch({ type: 'CLOSE_CONFIG' });
  const justSaved = savedAt > 0 && Date.now() - savedAt < 700;

  const handleAddUser = () => {
    if (!userDraft.id.trim() || !userDraft.path.trim()) return;
    addUserPlugin({
      id: userDraft.id.trim(),
      name: userDraft.name.trim() || userDraft.id.trim(),
      description: userDraft.description.trim(),
      version: userDraft.version.trim() || '0.1.0',
      source: 'user',
      path: userDraft.path.trim(),
    });
    setUserPluginsState(listUserPlugins());
    dispatch({ type: 'CLOSE_ADD_USER' });
    setTick((t) => t + 1);
  };

  const handleRemoveUser = (id: string) => {
    removeUserPlugin(id);
    setUserPluginsState(listUserPlugins());
    setTick((t) => t + 1);
  };

  const totalCount = PLUGINS.length + userPlugins.length;
  const activeCount = PLUGINS.filter((p) => isPluginEnabled(p.id)).length + userPlugins.length;

  return (
    <div className="plugin-panel">
      <div className="plugin-panel__head">
        <div className="row-flex-gap-6">
          <Puzzle size={14} color="var(--accent-primary)" />
          <span className="plugin-panel__title">Plugin Manager</span>
        </div>
        <div className="row-flex-gap-6">
          <span className="status-bar__value">{activeCount}/{totalCount} active</span>
          <button
            type="button"
            className="btn-ghost-sm"
            onClick={() => dispatch({ type: 'OPEN_ADD_USER' })}
            aria-label="Add custom plugin"
          >
            <Plus size={12} /> Add custom plugin
          </button>
        </div>
      </div>

      <div className="plugin-panel__scan-note">
        <FileCode2 size={11} />
        <span>{scannerNote}</span>
      </div>

      <div className="plugin-list">
        {PLUGINS.map((plugin) => (
          <PluginCard
            key={plugin.id}
            plugin={plugin}
            enabled={isPluginEnabled(plugin.id)}
            configured={isPluginConfigured(plugin.id)}
            onToggle={handleToggle}
            onConfigure={handleOpenConfig}
          />
        ))}

        {userPlugins.length > 0 && (
          <div className="plugin-section-label">User-installed ({userPlugins.length})</div>
        )}
        {userPlugins.map((up) => (
          <UserPluginCard key={up.id} plugin={up} onRemove={handleRemoveUser} />
        ))}
      </div>

      {configOpen && activePlugin && (
        <ConfigureModal
          plugin={activePlugin}
          configDraft={configDraft}
          justSaved={justSaved}
          onPatchField={(key, value) => dispatch({ type: 'PATCH_FIELD', key, value })}
          onSave={handleSaveConfig}
          onClose={handleClose}
        />
      )}

      {addUserOpen && (
        <AddUserPluginModal
          draft={userDraft}
          onPatch={(patch) => dispatch({ type: 'PATCH_USER', patch })}
          onSubmit={handleAddUser}
          onClose={() => dispatch({ type: 'CLOSE_ADD_USER' })}
        />
      )}
    </div>
  );
};

export default PluginManagerPanel;
