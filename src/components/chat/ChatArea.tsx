import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Bell, Search, Shield, Send, MoreVertical, Upload, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { messageChannels } from "../layout/sidebar/MessagesSection";

interface Message {
  id: string;
  content: string;
  timestamp: string;
  sender: {
    id: string;
    name: string;
    avatar: string;
  };
}

interface ChatAreaProps {
  recipientId: string;
}

const MOCK_MESSAGES: Record<string, Message[]> = {
  "team-chat": [
    {
      id: "1",
      content: "Hey Chris, had a question!\n\nAre you around sometime to chat?\n\nI have a couple questions about your recent paper",
      timestamp: "7:16 PM",
      sender: {
        id: "kathy",
        name: "Kathy McCooper",
        avatar: "https://images.unsplash.com/photo-1649972904349-6e44c42644a7"
      }
    },
    {
      id: "2",
      content: "Hey, Kathy\n\nGive me 5 minutes to get my ducks in order, but sure, we can chat.",
      timestamp: "7:16 PM",
      sender: {
        id: "chris",
        name: "Chris Thompson",
        avatar: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952"
      }
    },
    {
      id: "3",
      content: "Alright, what were you wondering about?",
      timestamp: "7:24 PM",
      sender: {
        id: "chris",
        name: "Chris Thompson",
        avatar: "https://images.unsplash.com/photo-1581092795360-fd1ca04f0952"
      }
    },
    {
      id: "4",
      content: "Emily had a few questions about the timeline you proposed. She thinks it might be a bit aggressive considering the projects that are already on the table. Have you connected with her yet, by chance?",
      timestamp: "7:16 PM",
      sender: {
        id: "kathy",
        name: "Kathy McCooper",
        avatar: "https://images.unsplash.com/photo-1649972904349-6e44c42644a7"
      }
    }
  ],
  "project-updates": [],
  "general-discussion": []
};

export const ChatArea = ({ recipientId }: ChatAreaProps) => {
  const messages = MOCK_MESSAGES[recipientId] || [];
  const currentChannel = messageChannels.find(channel => channel.id === recipientId);

  if (!currentChannel) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Channel not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#444A6C]">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-[#343A5C]">
        <div className="flex items-center space-x-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={currentChannel.avatar} />
            <AvatarFallback>{currentChannel.name[0]}</AvatarFallback>
          </Avatar>
          <div className="flex items-center space-x-2">
            <h1 className="text-xl font-semibold text-white">
              {currentChannel.name}
            </h1>
            <ChevronDown className="h-4 w-4 text-gray-400" />
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-gray-700">
            <Search className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-gray-700">
            <Bell className="h-5 w-5" />
          </Button>
        </div>
      </div>
      
      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            No messages yet
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className="flex items-start space-x-3">
                <Avatar className="h-10 w-10 mt-0.5">
                  <AvatarImage src={message.sender.avatar} />
                  <AvatarFallback>{message.sender.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-white">
                      {message.sender.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {message.timestamp}
                    </span>
                  </div>
                  <div className="mt-1 text-white whitespace-pre-line">
                    {message.content}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="p-4 border-t border-gray-800 bg-[#343A5C]">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1">
            <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-gray-700">
              <Upload className="h-5 w-5" />
            </Button>
          </div>
          <Input 
            placeholder={`Message ${currentChannel.name}`}
            className="flex-1 bg-[#444A6C] border-gray-700 text-white placeholder:text-gray-400"
          />
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-gray-700">
            <Shield className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-gray-400 hover:text-white hover:bg-gray-700">
            <MoreVertical className="h-5 w-5" />
          </Button>
          <Button size="icon" className="bg-purple-500 hover:bg-purple-600">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};