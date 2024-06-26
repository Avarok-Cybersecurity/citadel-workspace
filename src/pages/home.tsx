import { useEffect, useState } from "react"
import { invoke } from '@tauri-apps/api/core';
import { RegisterAndConnectInput } from "@hooks/c2s/useC2SConnect";
import genUuid from "@lib/utils";
import { ListAllPeersInput } from "@hooks/c2s/useListAllPeers";
import { listen } from "@tauri-apps/api/event";
import EventEmitter from "events";


export default function Home(){


    const [availablePeers, setAvailablePeers] = useState('')
    const [registered, setRegistered] = useState(false)


    // Connect to internal service and register with server
    useEffect(() => {

        async function inner(){
            // Init connection with server
            console.log("Connecting to citadel-internal-service")
            await invoke('open_connection', {
                addr: '127.0.0.1:12345',
              });


            // Send registration request
            console.log("Registering to server")
            const response_id = await invoke<string>(
                'register',
                {
                    fullName: 'test',
                    username: genUuid(),
                    proposedPassword: 'test',
                    serverAddr: '127.0.0.1:12349',
                  }
                )

            console.log(`Registered to server with response_id: ${response_id}`)

            // Listen for registration response
            const bus = new EventEmitter();
            let cid: number|null = null;
            const unlisten_register_listener = await listen(
                'packet_stream',
                (event: { payload: string }) => {
                    if (!registered){

                        const payload = JSON.parse(event.payload);

                        if (payload.error){
                            const err = JSON.stringify(payload.packet);
                            alert(err);
                            console.error(err);
                        }

                        else {
                            console.log(payload);
                            cid = payload.packet.ConnectSuccess.cid as number;
                            console.log(`Successfully registered to server with cid ${cid}, sending registration signal`)
                            bus.emit('registered');
                            setRegistered(true)
                        }
                    }
                    else{
                        console.warn("ignoring packet because already registered")
                    }
                }
              )


            // Block until registered
            console.log("Waiting for registration response...")
            await new Promise(resolve => bus.once('registered', resolve));
            console.log("Got registration response! Unblocking")

            if (cid === null){
                console.error("CID cannot be null after registration! Retrying...");
                return await inner();
            }

            unlisten_register_listener() // stop listening on packet_stream

            
            console.log(`Fetching available peers...`)
            const response = await invoke<string>(
                'list_all_peers',
                {
                    cid: (cid as number).toString()
                }
                );

            console.log(`Response from peer list: ${response}`)
            setAvailablePeers(response)








        } 



        
        inner();
    }, [])


    return <>
    
    <h1>Citadel Workspace</h1>
    <br />

    <h2>Registration Status</h2>
    <p>{registered ? "Registered ✅" : "🛑 Registering..."}</p>
    <br />

    <h2>Available Peers</h2>
    <p>Peers: {availablePeers}</p>
    <br />
    
    </>
}