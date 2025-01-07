import "./chat-header.css";
import { placeholderPfp } from "../../assets/assets";
import React from "react";

export default function ChatHeader() {
  return (
    <div id="chat-header">
      <div id="chat-user">
        <img src={placeholderPfp} />
        <h3>Placeholder User</h3>
        <i className="bi bi-chevron-down"></i>
      </div>
      <div id="chat-tools">
        <i className="bi bi-bell-slash"></i>
        <i className="bi bi-search"></i>
        <i className="bi bi-folder2-open"></i>
        <i className="bi bi-pin-angle"></i>
      </div>
    </div>
  );
}
