import React from "react";
import { useEffect, useState } from "react";
import { User } from "../../../api/user";
import "./sidebar.css";
import { Group } from "../../../api/group";
import { File } from "../../../api/file";
import { SidebarProps } from "./sidebar";

interface SidebarSectionProps extends SidebarProps {
  icon: React.ReactNode;
  title: string;
}

export default function SidebarSection({ peers, icon, title }: SidebarSectionProps) {
  useEffect(() => {
    if (peers) {
      setPeers(Object.keys(peers).map((el: string) => {
        return peers[el];
      }))
    }
  }, [peers])

  const [peersArr, setPeers] = useState(peers)

  return (
    <div className="sidebar-section">
      <div className="header">
        <h1>{title}</h1>
        <button style={{ display: icon ? "block" : "none" }}>
          {icon}
        </button>
      </div>
      {peersArr && peersArr.map((element) => {
        return (
          <div className="user-card">
            <h2>{element.name}</h2>
          </div>
        )
      })}
    </div>
  );
}
