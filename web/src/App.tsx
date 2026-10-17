import { Navigate, Route, Routes } from 'react-router-dom';
import { CarsPage } from './pages/Cars';
import { CheckInPage } from './pages/CheckIn';
import { DashboardPage } from './pages/Dashboard';
import { GuestTicketPage } from './pages/GuestTicket';
import { LoginPage } from './pages/Login';
import { PaymentsPage } from './pages/Payments';
import { QrApprovalsPage } from './pages/QrApprovals';
import { QueuePage } from './pages/Queue';
import { SettingsPage } from './pages/Settings';
import { StaffHome, StaffLayout } from './pages/StaffLayout';

export function App() {
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
      </Route>
      <Route path="*" element={<Navigate to="/staff" replace />} />
    </Routes>
  );
}
