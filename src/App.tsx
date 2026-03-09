import { Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';
import HistoryPage from './pages/HistoryPage';
import AccountPage from './pages/AccountPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/account" element={<AccountPage />} />
    </Routes>
  );
}
