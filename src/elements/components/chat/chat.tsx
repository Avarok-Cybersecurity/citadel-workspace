
import ChatHeader from "../chat-header/chat-header"
import ChatInput from "../chat-input/chat-input"
import "./chat.css"

export default function Chat(){
    return <div id="chat-window">
        <ChatHeader />
        <div className="chat-input-container">
            <ChatInput />
        </div>
    </div>
}