import React from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/AppLayout.jsx";
import { AuthPage } from "./pages/AuthPage.jsx";
import { ChatListPage } from "./pages/ChatListPage.jsx";
import { ChatRoomPage } from "./pages/ChatRoomPage.jsx";
import { CharactersPage } from "./pages/CharactersPage.jsx";
import { HomePage } from "./pages/HomePage.jsx";
import { MemoryPage } from "./pages/MemoryPage.jsx";
import { MomentsPage } from "./pages/MomentsPage.jsx";
import { ProfilePage } from "./pages/ProfilePage.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/chat" element={<ChatListPage />} />
        <Route path="/chat/:roleId" element={<ChatRoomPage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/moments" element={<MomentsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
