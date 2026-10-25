import { Navigate, Route, Routes } from 'react-router-dom';
import { IS_BROWSER_DEMO } from './api';
import { AccountPage } from './pages/Account';
import { CarsPage } from './pages/Cars';
import { CheckInPage } from './pages/CheckIn';
import { DashboardPage } from './pages/Dashboard';
import { DataPage } from './pages/Data';
import { GuestTicketPage } from './pages/GuestTicket';
import { LoginPage } from './pages/Login';
import { PaymentsPage } from './pages/Payments';
import { QrApprovalsPage } from './pages/QrApprovals';
import { QueuePage } from './pages/Queue';
import { SettingsPage } from './pages/Settings';
import { StaffPage } from './pages/Staff';
import { StaffHome, StaffLayout } from './pages/StaffLayout';

/** Shown on the GitHub Pages demo, where the server runs inside the browser. */
function PreviewBanner() {
  if (!IS_BROWSER_DEMO) return null;
  return (
    <div className="notice warn" role="status" style={{ borderRadius: 0, textAlign: 'center' }}>
      <strong>Demo on GitHub Pages.</strong> Everything runs in this browser and the data stays on this device, so open guest links on the same device. Sign in with the test
      logins below.
    </div>
  );
}

export function App() {
  return (
    <>
      <PreviewBanner />
      <AppRoutes />
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/t/:token" element={<GuestTicketPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/staff" element={<StaffLayout />}>
        <Route index element={<StaffHome />} />
        <Route path="check-in" element={<CheckInPage />} />
        <Route path="queue" element={<QueuePage />} />
        <Route path="cars" element={<CarsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="qr-approvals" element={<QrApprovalsPage />} />
        <Route path="data" element={<DataPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="account" element={<AccountPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/staff" replace />} />
    </Routes>
  );
}
