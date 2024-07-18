import "./header.css";

import { WorkspaceInfo } from "../../../api/types";
import sampleWorkspaceIcon from "../../../assets/sample-workspace.png";
import { useState } from "react";
import { placeholderPfp } from "../../../assets/assets";

function getActiveWorkspace(): WorkspaceInfo | null {
  return {
    iconPath: sampleWorkspaceIcon,
    name: "Citadel Workspace",
  };
}

export default function Header() {
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceInfo | null>(
    getActiveWorkspace(),
  );

  return (
    <div id="header">
      <div id="workspace-selector">
        <img src={activeWorkspace?.iconPath} />
        <h3>{activeWorkspace?.name}</h3>
        <i className="bi bi-chevron-down"></i>
      </div>
      <div id="header-selectors">
        <i className="bi bi-plus-square-dotted"></i>
        <i className="bi bi-plus-square-dotted"></i>
        <i className="bi bi-plus-square-dotted"></i>
        <div className="divider-horiz" />
        <i className="bi bi-gear"></i>
        <i className="bi bi-bell"></i>
        <img src={placeholderPfp} className="user-icon" />
      </div>
    </div>
  );
}
