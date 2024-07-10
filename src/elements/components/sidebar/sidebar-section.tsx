
import { useEffect, useState } from "react"
import { User } from "../../../api/user"
import "./sidebar.css"

export default function SidebarSection(props: {title: string, icon: JSX.Element, items: User[]}){


    function buildUserCard(user: User, meta: string){

        return <div className="user-card">
            <img src={user.imagePath} />
            <h2>
                {user.name}
            </h2>
            <p>
                {meta}
            </p>
        </div>
    }


    const [userCards, setUserCards] = useState<JSX.Element[]>();

    useEffect(()=>{
        console.log(`updating ${props.title} sidebar`)


        var cards: JSX.Element[] = []
        props.items.forEach((item)=>{
            if (item instanceof User){
                cards.push(buildUserCard(item, "Now"))
            }
        })

        console.log("cards:")
        console.log(cards)

        setUserCards(cards)

    },[])



    return <div className="sidebar-section">
        <div className="header">
            <h1>{props.title}</h1>
            <button>
                {props.icon}
            </button>
        </div>
        {userCards}
    </div>
}