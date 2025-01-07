import React from "react";
import SidebarSection from "./sidebar-section";
import { User } from "../../../api/user";
import {
  placeholderPfp,
  notepadSvg,
  placeholderGroup,
} from "../../../assets/assets";
import "./sidebar.css";
import { Group } from "../../../api/group";

function getPinnedUsers(): User[] {
  const names = [];

  for (let i = 0; i < 2; i++) {
    names.push("Placeholder User");
  }

  const people: User[] = [];
  names.forEach((name: string) => {
    (async () => {
      const user = new User(name, placeholderPfp);
      people.push(user);
      await new Promise((res) => setTimeout(res, 1000));
    })();
  });

  return people;
}
function getContacts(): User[] {
  const names = [];
  for (let i = 0; i < 5; i++) {
    names.push("Placeholder User");
  }

  const people: User[] = [];
  names.forEach((name: string) => {
    (async () => {
      const user = new User(name, placeholderPfp);
      people.push(user);
      await new Promise((res) => setTimeout(res, 1000));
    })();
  });

  return people;
}
export interface SidebarProps {
  peers: Array<{
    name: string;
    username: string;
    online_status: boolean;
    cid: number
  }>
}

export default function Sidebar(props: SidebarProps) {
  return (
    <div id="sidebar">
      <SidebarSection
        title="CONTACTS"
        icon={notepadSvg}
        peers={props.peers}
      />
    </div>
  );
}
