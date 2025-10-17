// apps/web/src/App.tsx
import { Outlet } from "react-router-dom";
import TopNav from "./components/TopNav";
import { Toaster } from "react-hot-toast";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <Outlet />
      <Toaster position="top-right" />
    </div>
  );
}
