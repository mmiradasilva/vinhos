import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Navigate, RouterProvider, createBrowserRouter } from 'react-router';
import { AuthProvider, RequireAuth } from './auth';
import { Layout } from './components/Layout';
import { PrivacyPage, TermsPage } from './legal/LegalPages';
import { CollectionPage } from './pages/Collection';
import { WineDetailPage } from './pages/WineDetail';
import { AddWinePage, EditWinePage } from './pages/WineForm';
import { SignInPage } from './pages/SignIn';
import { WelcomePage } from './pages/Welcome';
import './styles.css';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Navigate to="/collection" replace /> },
      { path: '/signin', element: <SignInPage /> },
      { path: '/welcome', element: <WelcomePage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/collection', element: <RequireAuth><CollectionPage /></RequireAuth> },
      { path: '/collection/new', element: <RequireAuth><AddWinePage /></RequireAuth> },
      { path: '/collection/wines/:id', element: <RequireAuth><WineDetailPage /></RequireAuth> },
      { path: '/collection/wines/:id/edit', element: <RequireAuth><EditWinePage /></RequireAuth> },
      { path: '*', element: <Navigate to="/collection" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
