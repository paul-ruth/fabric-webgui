'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ProjectDetails, SliceSummary } from '../types/fabric';
import * as api from '../api/client';
import '../styles/project-view.css';

interface ProjectViewProps {
  projectId: string;
  slices: SliceSummary[];
  onRefreshSlices?: () => void;
}

const DEAD_STATES = new Set(['Dead', 'Closing']);

export default function ProjectView({ projectId, slices, onRefreshSlices }: ProjectViewProps) {
  const [details, setDetails] = useState<ProjectDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchDetails = useCallback(async () => {
    if (!projectId) { setDetails(null); return; }
    setLoading(true);
    setError('');
    try {
      const data = await api.getProjectDetails(projectId);
      setDetails(data);
    } catch (e: any) {
      setError(e.message);
      setDetails(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDetails();
    onRefreshSlices?.();
  }, [fetchDetails]); // eslint-disable-line react-hooks/exhaustive-deps

  const formatDate = (iso: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  const buildMemberList = () => {
    if (!details) return [];
    const seen = new Set<string>();
    const members: Array<{ name: string; email: string; uuid: string; role: string }> = [];
    const addPerson = (person: { name: string; email: string; uuid: string }, role: string) => {
      if (seen.has(person.uuid)) return;
      seen.add(person.uuid);
      members.push({ ...person, role });
    };
    if (details.project_lead) addPerson(details.project_lead, 'lead');
    for (const p of details.project_owners) addPerson(p, 'owner');
    for (const p of details.project_members) addPerson(p, 'member');
    for (const p of details.project_creators) addPerson(p, 'creator');
    return members;
  };

  const memberList = buildMemberList();
  const activeSlices = useMemo(() => slices.filter(s => !DEAD_STATES.has(s.state) && !s.archived).length, [slices]);
  const totalSlices = slices.length;

  if (!projectId) {
    return (
      <div className="pv-root">
        <div className="pv-empty">No project selected. Choose a project from the title bar.</div>
      </div>
    );
  }

  if (loading && !details) {
    return (
      <div className="pv-root">
        <div className="pv-loading">Loading project details...</div>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="pv-root">
        <div className="pv-error">{error}</div>
      </div>
    );
  }

  return (
    <div className="pv-root" data-help-id="project.panel">
      {/* Header */}
      {details && (
        <div className="pv-header">
          <div className="pv-header-top">
            <h1 className="pv-title">{details.name}</h1>
            {details.project_type && <span className="pv-badge pv-badge-type">{details.project_type}</span>}
            {details.active ? (
              <span className="pv-badge pv-badge-active">Active</span>
            ) : (
              <span className="pv-badge pv-badge-inactive">Inactive</span>
            )}
            {details.created && <span className="pv-header-date">Created {formatDate(details.created)}</span>}
          </div>
          {details.description && (
            <div className="pv-description" dangerouslySetInnerHTML={{ __html: details.description }} />
          )}
        </div>
      )}

      {/* Stats row */}
      <div className="pv-stats-row">
        <div className="pv-stat-card">
          <div className="pv-stat-value">{activeSlices}</div>
          <div className="pv-stat-label">Active Slices</div>
        </div>
        <div className="pv-stat-card">
          <div className="pv-stat-value">{totalSlices}</div>
          <div className="pv-stat-label">Total Slices</div>
        </div>
        <div className="pv-stat-card">
          <div className="pv-stat-value">{memberList.length}</div>
          <div className="pv-stat-label">Members</div>
        </div>
      </div>

      {/* Two-column grid */}
      <div className="pv-grid">
        {/* Left: Members */}
        <div className="pv-column">
          <div className="pv-section-title">Members ({memberList.length})</div>
          {memberList.length === 0 ? (
            <div className="pv-muted">No members found.</div>
          ) : (
            <ul className="pv-member-list">
              {memberList.map(m => (
                <li key={m.uuid} className={`pv-member ${m.role === 'lead' ? 'pv-member-lead' : ''}`}>
                  <div className="pv-member-info">
                    <span className="pv-member-name">{m.name || m.email}</span>
                    <span className="pv-member-email">{m.email}</span>
                  </div>
                  <span className={`pv-role-badge ${m.role}`}>{m.role}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: Details */}
        <div className="pv-column">
          {/* Permission Tags */}
          {details && details.tags && details.tags.length > 0 && (
            <div className="pv-detail-section">
              <div className="pv-section-title">Permission Tags</div>
              <div className="pv-tags">
                {details.tags.map((tag, i) => (
                  <span key={i} className="pv-tag">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Funding */}
          {details && details.project_funding && details.project_funding.length > 0 && (
            <div className="pv-detail-section">
              <div className="pv-section-title">Funding</div>
              {details.project_funding.map((f, i) => (
                <div key={i} className="pv-funding-card">
                  <div className="pv-funding-agency">{f.agency}</div>
                  {f.award_number && <div className="pv-funding-detail">Award: {f.award_number}</div>}
                  {f.award_amount > 0 && <div className="pv-funding-detail">Amount: ${f.award_amount.toLocaleString()}</div>}
                  {f.directorate && <div className="pv-funding-detail">Directorate: {f.directorate}</div>}
                </div>
              ))}
            </div>
          )}

          {/* Communities */}
          {details && details.communities && details.communities.length > 0 && (
            <div className="pv-detail-section">
              <div className="pv-section-title">Communities</div>
              <div className="pv-tags">
                {details.communities.map((c, i) => (
                  <span key={i} className="pv-tag">{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
