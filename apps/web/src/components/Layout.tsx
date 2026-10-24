import { Link, Outlet } from 'react-router';
import { useAuth } from '../auth';

export function Layout() {
  const { state, signOut } = useAuth();
  return (
    <>
      <header className="app-header">
        <Link to="/collection" className="brand">
          Cellar
        </Link>
        {state.status === 'signed-in' && (
          <details className="user-menu">
            <summary>
              <span className="sr-only">Account menu: </span>
              {state.me.display_name ?? state.me.email}
            </summary>
            <div className="user-menu-panel">
              <p className="muted">{state.me.email}</p>
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>
          </details>
        )}
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  );
}
