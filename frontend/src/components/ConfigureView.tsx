import { useState, useEffect, useRef, useCallback } from 'react';
import * as api from '../api/client';
import type { ConfigStatus, ProjectInfo } from '../types/fabric';
import '../styles/configure.css';

interface ConfigureViewProps {
  onConfigured: () => void;
}

export default function ConfigureView({ onConfigured }: ConfigureViewProps) {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [bastionLogin, setBastionLogin] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [generatedPubKey, setGeneratedPubKey] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showTokenPaste, setShowTokenPaste] = useState(false);
  const [pastedToken, setPastedToken] = useState('');

  // Advanced settings
  const [credmgrHost, setCredmgrHost] = useState('cm.fabric-testbed.net');
  const [orchestratorHost, setOrchestratorHost] = useState('orchestrator.fabric-testbed.net');
  const [coreApiHost, setCoreApiHost] = useState('uis.fabric-testbed.net');
  const [bastionHost, setBastionHost] = useState('bastion.fabric-testbed.net');
  const [amHost, setAmHost] = useState('artifacts.fabric-testbed.net');
  const [logLevel, setLogLevel] = useState('INFO');
  const [logFile, setLogFile] = useState('/tmp/fablib/fablib.log');
  const [avoidSet, setAvoidSet] = useState<Set<string>>(new Set());
  const [siteNames, setSiteNames] = useState<string[]>([]);
  const [sshCommandLine, setSshCommandLine] = useState(
    'ssh -i {{ _self_.private_ssh_key_file }} -F {config_dir}/ssh_config {{ _self_.username }}@{{ _self_.management_ip }}'
  );

  const tokenFileRef = useRef<HTMLInputElement>(null);
  const bastionKeyRef = useRef<HTMLInputElement>(null);
  const slicePrivKeyRef = useRef<HTMLInputElement>(null);
  const slicePubKeyRef = useRef<HTMLInputElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.getConfig();
      setStatus(s);
      if (s.project_id) setSelectedProject(s.project_id);
      if (s.bastion_username) setBastionLogin(s.bastion_username);
    } catch {
      // ignore on initial load
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Load projects when token is available
  const loadProjects = useCallback(async () => {
    try {
      const data = await api.getProjects();
      setProjects(data.projects);
      if (data.bastion_login) setBastionLogin(data.bastion_login);
      if (data.projects.length > 0) {
        setSelectedProject(data.projects[0].uuid);
      }
    } catch (e: any) {
      setMessage({ text: `Failed to load projects: ${e.message}`, type: 'error' });
    }
  }, []);

  useEffect(() => {
    if (status?.has_token) {
      loadProjects();
    }
  }, [status?.has_token, loadProjects]);

  // Load site names for avoid selector
  useEffect(() => {
    api.listSites().then((sites) => {
      setSiteNames(sites.map((s) => s.name).sort());
    }).catch(() => {});
  }, []);

  const toggleAvoidSite = (site: string) => {
    setAvoidSet((prev) => {
      const next = new Set(prev);
      if (next.has(site)) next.delete(site);
      else next.add(site);
      return next;
    });
  };

  const handleTokenUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await api.uploadToken(file);
      setMessage({ text: 'Token uploaded successfully', type: 'success' });
      await loadStatus();
      await loadProjects();
    } catch (err: any) {
      setMessage({ text: `Token upload failed: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      if (tokenFileRef.current) tokenFileRef.current.value = '';
    }
  };

  const handleOAuthLogin = async () => {
    try {
      const { login_url } = await api.getLoginUrl();
      window.open(login_url, '_blank');
      setShowTokenPaste(true);
    } catch (err: any) {
      setMessage({ text: `Login failed: ${err.message}`, type: 'error' });
    }
  };

  const handlePasteToken = async () => {
    if (!pastedToken.trim()) return;
    setLoading(true);
    try {
      await api.pasteToken(pastedToken);
      setMessage({ text: 'Token saved successfully', type: 'success' });
      setPastedToken('');
      setShowTokenPaste(false);
      await loadStatus();
      await loadProjects();
    } catch (err: any) {
      setMessage({ text: `Token paste failed: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleBastionKeyUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      await api.uploadBastionKey(file);
      setMessage({ text: 'Bastion key uploaded', type: 'success' });
      await loadStatus();
    } catch (err: any) {
      setMessage({ text: `Bastion key upload failed: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      if (bastionKeyRef.current) bastionKeyRef.current.value = '';
    }
  };

  const handleSliceKeyUpload = async () => {
    const privFile = slicePrivKeyRef.current?.files?.[0];
    const pubFile = slicePubKeyRef.current?.files?.[0];
    if (!privFile || !pubFile) {
      setMessage({ text: 'Select both private and public key files', type: 'error' });
      return;
    }
    setLoading(true);
    try {
      await api.uploadSliceKeys(privFile, pubFile);
      setMessage({ text: 'Slice keys uploaded', type: 'success' });
      await loadStatus();
    } catch (err: any) {
      setMessage({ text: `Slice key upload failed: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
      if (slicePrivKeyRef.current) slicePrivKeyRef.current.value = '';
      if (slicePubKeyRef.current) slicePubKeyRef.current.value = '';
    }
  };

  const handleGenerateKeys = async () => {
    setLoading(true);
    try {
      const result = await api.generateSliceKeys();
      setGeneratedPubKey(result.public_key);
      setMessage({ text: result.message, type: 'success' });
      await loadStatus();
    } catch (err: any) {
      setMessage({ text: `Key generation failed: ${err.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPubKey = () => {
    navigator.clipboard.writeText(generatedPubKey);
    setMessage({ text: 'Public key copied to clipboard', type: 'success' });
  };

  const handleSave = async () => {
    if (!selectedProject) {
      setMessage({ text: 'Please select a project', type: 'error' });
      return;
    }
    if (!bastionLogin) {
      setMessage({ text: 'Bastion username is required', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const result = await api.saveConfig({
        project_id: selectedProject,
        bastion_username: bastionLogin,
        credmgr_host: credmgrHost,
        orchestrator_host: orchestratorHost,
        core_api_host: coreApiHost,
        bastion_host: bastionHost,
        am_host: amHost,
        log_level: logLevel,
        log_file: logFile,
        avoid: Array.from(avoidSet).join(','),
        ssh_command_line: sshCommandLine,
      });
      if (result.configured) {
        setMessage({ text: 'Configuration saved! FABRIC is ready.', type: 'success' });
        await loadStatus();
        onConfigured();
      } else {
        setMessage({ text: 'Configuration saved but some items are still missing.', type: 'error' });
        await loadStatus();
      }
    } catch (err: any) {
      setMessage({ text: `Save failed: ${err.message}`, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const tokenExpiry = status?.token_info?.exp
    ? new Date(status.token_info.exp * 1000).toLocaleString()
    : null;

  return (
    <div className="configure-view">
      <div className="configure-card">
        {/* Status Banner */}
        <div className="status-banner">
          <div className="status-item">
            <span className={`status-dot ${status?.has_token ? 'ok' : 'missing'}`} />
            Token
          </div>
          <div className="status-item">
            <span className={`status-dot ${status?.has_bastion_key ? 'ok' : 'missing'}`} />
            Bastion Key
          </div>
          <div className="status-item">
            <span className={`status-dot ${status?.has_slice_key ? 'ok' : 'missing'}`} />
            Slice Keys
          </div>
          <div className="status-item">
            <span className={`status-dot ${selectedProject ? 'ok' : 'missing'}`} />
            Project
          </div>
        </div>

        {/* Global message */}
        {message && (
          <div className={`configure-section message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Token Section */}
        <div className="configure-section">
          <h3>Authentication Token</h3>
          <p>Upload a token file, or login with FABRIC to get a token from Credential Manager.</p>
          <div className="btn-row">
            <input
              ref={tokenFileRef}
              type="file"
              accept=".json"
              className="file-input-hidden"
              onChange={handleTokenUpload}
            />
            <button
              className="btn"
              onClick={() => tokenFileRef.current?.click()}
              disabled={loading}
            >
              Upload Token File
            </button>
            <button className="btn primary" onClick={handleOAuthLogin} disabled={loading}>
              Login with FABRIC
            </button>
          </div>
          {showTokenPaste && (
            <div style={{ marginTop: 12 }}>
              <p>Credential Manager opened in a new tab. After logging in, copy the token JSON and paste it below.</p>
              <textarea
                className="token-paste-area"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
                placeholder='Paste the token JSON here, e.g. {"id_token": "...", "refresh_token": "..."}'
                rows={4}
              />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button
                  className="btn primary"
                  onClick={handlePasteToken}
                  disabled={loading || !pastedToken.trim()}
                >
                  {loading ? 'Saving...' : 'Save Token'}
                </button>
                <button
                  className="btn"
                  onClick={() => { setShowTokenPaste(false); setPastedToken(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {status?.token_info && !status.token_info.error && (
            <div className="token-info">
              {status.token_info.name && <span>User: {status.token_info.name}</span>}
              {status.token_info.email && <span>Email: {status.token_info.email}</span>}
              {tokenExpiry && <span>Expires: {tokenExpiry}</span>}
            </div>
          )}
        </div>

        {/* Project Section */}
        <div className="configure-section">
          <h3>Project</h3>
          <p>Select your FABRIC project.</p>
          <select
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
            disabled={projects.length === 0}
          >
            <option value="">-- Select Project --</option>
            {projects.map((p) => (
              <option key={p.uuid} value={p.uuid}>
                {p.name} ({p.uuid.slice(0, 8)}...)
              </option>
            ))}
          </select>
          {projects.length === 0 && status?.has_token && (
            <p>Loading projects from token...</p>
          )}
        </div>

        {/* SSH Keys Section */}
        <div className="configure-section">
          <h3>SSH Keys</h3>

          {/* Bastion Key */}
          <p><strong>Bastion Key</strong> — Upload your FABRIC bastion private key (from the portal).</p>
          <div className="btn-row">
            <input
              ref={bastionKeyRef}
              type="file"
              className="file-input-hidden"
              onChange={handleBastionKeyUpload}
            />
            <button
              className="btn"
              onClick={() => bastionKeyRef.current?.click()}
              disabled={loading}
            >
              Upload Bastion Key
            </button>
            {status?.has_bastion_key && <span className="status-item"><span className="status-dot ok" /> Uploaded</span>}
          </div>

          {/* Slice Keys */}
          <p style={{ marginTop: 16 }}><strong>Slice Keys</strong> — Upload an existing key pair or generate new ones.</p>
          <div className="btn-row">
            <input ref={slicePrivKeyRef} type="file" className="file-input-hidden" />
            <input ref={slicePubKeyRef} type="file" className="file-input-hidden" />
            <button
              className="btn"
              onClick={() => slicePrivKeyRef.current?.click()}
              disabled={loading}
            >
              Private Key
            </button>
            <button
              className="btn"
              onClick={() => slicePubKeyRef.current?.click()}
              disabled={loading}
            >
              Public Key
            </button>
            <button
              className="btn"
              onClick={handleSliceKeyUpload}
              disabled={loading || !slicePrivKeyRef.current?.files?.length || !slicePubKeyRef.current?.files?.length}
            >
              Upload Pair
            </button>
            <button className="btn success" onClick={handleGenerateKeys} disabled={loading}>
              Generate Keys
            </button>
            {status?.has_slice_key && <span className="status-item"><span className="status-dot ok" /> Ready</span>}
          </div>
          {generatedPubKey && (
            <div className="key-display">
              <button className="copy-btn" onClick={handleCopyPubKey}>Copy</button>
              {generatedPubKey}
            </div>
          )}
        </div>

        {/* Bastion Username */}
        <div className="configure-section">
          <h3>Bastion Username</h3>
          <p>Your FABRIC bastion login username (auto-detected from token when possible).</p>
          <input
            type="text"
            value={bastionLogin}
            onChange={(e) => setBastionLogin(e.target.value)}
            placeholder="e.g. user_name_0001234567"
          />
        </div>

        {/* Advanced Settings */}
        <div className="configure-section">
          <button className="advanced-toggle" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Hide' : 'Show'} Advanced Settings
          </button>
          {showAdvanced && (
            <div style={{ marginTop: 12 }}>
              <p>Credential Manager Host</p>
              <input type="text" value={credmgrHost} onChange={(e) => setCredmgrHost(e.target.value)} />
              <p>Orchestrator Host</p>
              <input type="text" value={orchestratorHost} onChange={(e) => setOrchestratorHost(e.target.value)} />
              <p>Core API Host</p>
              <input type="text" value={coreApiHost} onChange={(e) => setCoreApiHost(e.target.value)} />
              <p>Bastion Host</p>
              <input type="text" value={bastionHost} onChange={(e) => setBastionHost(e.target.value)} />
              <p>Artifact Manager Host</p>
              <input type="text" value={amHost} onChange={(e) => setAmHost(e.target.value)} />
              <p>Log Level</p>
              <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)}>
                <option>DEBUG</option>
                <option>INFO</option>
                <option>WARNING</option>
                <option>ERROR</option>
              </select>
              <p>Log File</p>
              <input type="text" value={logFile} onChange={(e) => setLogFile(e.target.value)} />
              <p>Sites to Avoid</p>
              <div className="site-toggle-grid">
                {siteNames.map((site) => (
                  <button
                    key={site}
                    className={`site-toggle ${avoidSet.has(site) ? 'avoided' : ''}`}
                    onClick={() => toggleAvoidSite(site)}
                    type="button"
                  >
                    {site}
                  </button>
                ))}
              </div>
              {avoidSet.size > 0 && (
                <p style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
                  Avoiding: {Array.from(avoidSet).sort().join(', ')}
                </p>
              )}
              <p>SSH Command Line</p>
              <input type="text" value={sshCommandLine} onChange={(e) => setSshCommandLine(e.target.value)} />
            </div>
          )}
        </div>

        {/* Save */}
        <div className="configure-section save-section">
          <button
            className="btn primary"
            onClick={handleSave}
            disabled={saving || !status?.has_token || !selectedProject || !bastionLogin}
            style={{ padding: '12px 48px', fontSize: 15 }}
          >
            {saving ? 'Saving...' : 'Save & Apply'}
          </button>
        </div>
      </div>
    </div>
  );
}
