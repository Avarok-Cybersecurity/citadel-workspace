import { AppLayout } from "@/components/layout/AppLayout";
import { ChatArea } from "@/components/chat/ChatArea";
import { useLocation } from "react-router-dom";

const Messages = () => {
  const location = useLocation();
  const channel = new URLSearchParams(location.search).get("channel") || "team-chat";

  return (
    <AppLayout>
      <ChatArea recipientId={channel} />
    </AppLayout>
  );
};

export default Messages;