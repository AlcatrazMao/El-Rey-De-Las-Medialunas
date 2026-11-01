import { describe, it, expect } from 'vitest';

describe('Document Settings & Customizations branch resolution', () => {
  const DEFAULT_BRANCH_ID = '00000000000000000000000000000001';

  function resolveBranch(c: {
    branchId?: string;
    queryBranchId?: string;
    headerBranchId?: string;
    userDefaultBranch?: string;
  }): string {
    return (
      c.branchId ||
      c.queryBranchId ||
      c.headerBranchId ||
      c.userDefaultBranch ||
      DEFAULT_BRANCH_ID
    );
  }

  it('uses contextual branchId when present', () => {
    expect(resolveBranch({ branchId: 'branch-10' })).toBe('branch-10');
  });

  it('falls back to query param branch_id when branchId is empty (elevated aggregated role)', () => {
    expect(resolveBranch({ branchId: '', queryBranchId: 'branch-2' })).toBe('branch-2');
  });

  it('falls back to X-Branch-Id header when branchId and query are empty', () => {
    expect(resolveBranch({ branchId: '', headerBranchId: 'branch-3' })).toBe('branch-3');
  });

  it('falls back to userDefaultBranch when query/header are missing', () => {
    expect(resolveBranch({ branchId: '', userDefaultBranch: 'branch-user' })).toBe('branch-user');
  });

  it('falls back to DEFAULT_BRANCH_ID when no branch info is available', () => {
    expect(resolveBranch({ branchId: '' })).toBe(DEFAULT_BRANCH_ID);
  });
});

describe('Cash session close idempotency and fallback logic', () => {
  interface CashSessionStub {
    id: string;
    user_id: string;
    branch_id: string;
    status: 'open' | 'closed' | 'auto_closed';
    opened_at: string;
    difference: number | null;
    closed_at: string | null;
  }

  function simulateCloseLookup(params: {
    sessions: CashSessionStub[];
    sessionIdParam: string;
    userId: string;
    userRole: string;
    branchId: string;
  }): { foundSession?: CashSessionStub; alreadyClosed?: CashSessionStub; status: number } {
    const { sessions, sessionIdParam, userId, userRole, branchId } = params;

    let session: CashSessionStub | undefined;

    if (userRole === 'cashier') {
      if (sessionIdParam && sessionIdParam !== 'current' && sessionIdParam !== 'close') {
        session = sessions.find(s => s.id === sessionIdParam && s.user_id === userId && s.status === 'open');
      }
      if (!session) {
        // Fallback: active session for this cashier
        session = sessions.find(s => s.user_id === userId && s.status === 'open');
      }
    } else {
      if (sessionIdParam && sessionIdParam !== 'current' && sessionIdParam !== 'close') {
        session = sessions.find(s => s.id === sessionIdParam && s.status === 'open');
      }
      if (!session) {
        session = sessions.find(s => s.branch_id === branchId && s.status === 'open');
      }
    }

    if (session) {
      return { foundSession: session, status: 200 };
    }

    // Check if already closed (idempotency)
    if (sessionIdParam && sessionIdParam !== 'current' && sessionIdParam !== 'close') {
      const alreadyClosed = sessions.find(
        s => s.id === sessionIdParam && (s.status === 'closed' || s.status === 'auto_closed')
      );
      if (alreadyClosed) {
        return { alreadyClosed, status: 200 };
      }
    }

    return { status: 404 };
  }

  it('finds active session by exact id for cashier', () => {
    const sessions: CashSessionStub[] = [
      { id: 'ses-1', user_id: 'u1', branch_id: 'b1', status: 'open', opened_at: '2026-10-25', difference: null, closed_at: null },
    ];
    const res = simulateCloseLookup({
      sessions,
      sessionIdParam: 'ses-1',
      userId: 'u1',
      userRole: 'cashier',
      branchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(res.foundSession?.id).toBe('ses-1');
  });

  it('falls back to active cashier session when local id was unsynced (cash_ses_*)', () => {
    const sessions: CashSessionStub[] = [
      { id: 'd1-session-123', user_id: 'u1', branch_id: 'b1', status: 'open', opened_at: '2026-10-25', difference: null, closed_at: null },
    ];
    const res = simulateCloseLookup({
      sessions,
      sessionIdParam: 'cash_ses_1730000000',
      userId: 'u1',
      userRole: 'cashier',
      branchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(res.foundSession?.id).toBe('d1-session-123');
  });

  it('returns already_closed 200 idempotently when session was already closed', () => {
    const sessions: CashSessionStub[] = [
      { id: 'ses-closed', user_id: 'u1', branch_id: 'b1', status: 'closed', opened_at: '2026-10-25', difference: 0, closed_at: '2026-10-25T12:00:00' },
    ];
    const res = simulateCloseLookup({
      sessions,
      sessionIdParam: 'ses-closed',
      userId: 'u1',
      userRole: 'cashier',
      branchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(res.alreadyClosed?.id).toBe('ses-closed');
  });

  it('returns 404 when no session exists at all', () => {
    const sessions: CashSessionStub[] = [];
    const res = simulateCloseLookup({
      sessions,
      sessionIdParam: 'non-existent',
      userId: 'u1',
      userRole: 'cashier',
      branchId: 'b1',
    });
    expect(res.status).toBe(404);
  });
});
