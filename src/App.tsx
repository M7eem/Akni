import { Routes, Route, Navigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import AccountPage from './pages/AccountPage';
import TermsPage from './pages/TermsPage';
import ScrollToTop from './components/ScrollToTop';

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/history" element={<Navigate to="/account?tab=history" replace />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/terms" element={<TermsPage />} />
      </Routes>
    </>
  );
}
