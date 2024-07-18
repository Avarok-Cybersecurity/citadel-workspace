import { useEffect, useState } from "react";
import { User } from "../../../api/user";
import "./sidebar.css";
import { Group } from "../../../api/group";
import { File } from "../../../api/file";

export default function SidebarSection(props: {
  title: string;
  icon: JSX.Element | null;
  items: (User | Group | File)[];
}) {
  function buildUserCard(user: User, meta: string) {
    return (
      <div className="user-card">
        <img src={user.imagePath} />
        <h2>{user.name}</h2>
        <p>{meta}</p>
      </div>
    );
  }
  function buildGroupCard(group: Group, meta: string) {
    return (
      <div className="group-card">
        <img src={group.imagePath} />
        <h2>{group.name}</h2>
        <p>{meta}</p>
      </div>
    );
  }
  function buildFileCard(file: File) {
    return (
      <div className="file-card">
        {file.icon}
        <h2>{file.name}</h2>
      </div>
    );
  }

  const [userCards, setUserCards] = useState<JSX.Element[]>();

  useEffect(() => {
    console.log(`updating ${props.title} sidebar`);

    var cards: JSX.Element[] = [];
    props.items.forEach((item) => {
      if (item instanceof User) {
        cards.push(buildUserCard(item, "Now"));
      } else if (item instanceof Group) {
        cards.push(buildGroupCard(item, "Now"));
      } else if (item instanceof File) {
        cards.push(buildFileCard(item));
      }
    });

    console.log("cards:");
    console.log(cards);

    setUserCards(cards);
  }, []);

  return (
    <div className="sidebar-section">
      <div className="header">
        <h1>{props.title}</h1>
        <button style={{ display: !!props.icon ? "block" : "none" }}>
          {props.icon}
        </button>
      </div>
      {userCards}
    </div>
  );
}
