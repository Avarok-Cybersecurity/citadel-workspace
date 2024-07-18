import { useEffect, useRef, useState } from "react";
import "./chat-input.css";

const MIN_INPUT_HEIGHT = 16; //px
const MAX_INPUT_HEIGHT = 300; //px

export default function ChatInput() {
  const [textboxContent, setTextboxContent] = useState("");
  const textboxRef = useRef<HTMLTextAreaElement>(null); // a reference to the textbox

  useEffect(() => {
    if (textboxRef.current !== null) {
      textboxRef.current.style.height = `${MIN_INPUT_HEIGHT}px`;
      var desiredHeight = textboxRef.current.scrollHeight - 22;
      console.log(`Scroll height is ${desiredHeight}`);
      if (desiredHeight < MIN_INPUT_HEIGHT) {
        desiredHeight = MIN_INPUT_HEIGHT;
      } else if (desiredHeight > MAX_INPUT_HEIGHT) {
        desiredHeight = MAX_INPUT_HEIGHT;
      }
      textboxRef.current.style.height = `${desiredHeight}px`;
    }
  }, [textboxContent]);

  return (
    <div id="chat-input">
      <textarea
        placeholder="Send a message to Placeholder User"
        ref={textboxRef}
        id="message-input"
        value={textboxContent}
        onChange={(ev) => {
          setTextboxContent(ev.target.value);
        }}
      ></textarea>
      <div id="input-button-container">
        <i className="bi bi-three-dots"></i>
        <i className="bi bi-shield-lock"></i>
        <i className="bi bi-cloud-arrow-up"></i>
        <i className="bi bi-send"></i>
      </div>
    </div>
  );
}
