
import SidebarSection from "./sidebar-section"
import {User} from "../../../api/user"
import { defaultPfp, notepadSvg } from "../../../assets/assets"
import "./sidebar.css"

function getPinnedUsers(): User[]{
    
    const names = []

    for (var i = 0; i<2; i++){
        names.push("Placeholder User")
    }

    var people: User[] = [];
     names.forEach((name: string)=>{

        (async () => {
            const user = new User(name, defaultPfp);
            people.push(user);
            await new Promise(res => setTimeout(res, 1000))
        })()
     })

    return people;
}
function getContacts(): User[]{
    
    const names = []

    for (var i = 0; i<5; i++){
        names.push("Placeholder User")
    }

    var people: User[] = [];
     names.forEach((name: string)=>{

        (async () => {
            const user = new User(name, defaultPfp);
            people.push(user);
            await new Promise(res => setTimeout(res, 1000))
        })()
     })

    return people;
}

export default function Sidebar(){
    return <div id="sidebar">

    <SidebarSection title="PINNED" icon={<i className="bi bi-plus"></i>} items={getPinnedUsers()}/>
    <SidebarSection title="CONTACTS" icon={notepadSvg} items={getContacts()}/>


    </div>
}