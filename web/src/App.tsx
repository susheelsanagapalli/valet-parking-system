import { Navigate, Route, Routes } from 'react-router-dom';
import { IS_PREVIEW_WITHOUT_SERVER } from './api';
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
import { StaffHome, StaffLayout } from './pages/StaffLayout';

/** Shown on the GitHub Pages preview, which has no server behind it. */
function PreviewBanner() {
  if (!IS_PREVIEW_WITHOUT_SERVER) return null;
  return (
    <div className="notice warn" role="status" style={{ borderRadius: 0, textAlign: 'center' }}>
      <strong>Preview on GitHub Pages.</strong> These are the app's screens only: signing in, check-in and saving need the Valet server, which GitHub Pages cannot run. Ask the
      administrator for the live address.
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
      </Route>
      <Route path="*" element={<Navigate to="/staff" replace />} />
    </Routes>
  );
}
