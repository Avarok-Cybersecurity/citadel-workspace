import { Payload, PeerRegisterNotification } from '@common/types/c2sResponses';
import { addToNotificationsContext } from '@redux/slices/notificationsHandler.slice';
import store from '@redux/store';

const handleNotificationPacket = ({ payload }: Payload, key: string) => {
  const { notificationsContext } = store.getState();

  if (key) {
    switch (key) {
      case 'PeerRegisterNotification':
        console.log('Noticiation packet', payload);
        store.dispatch(
          addToNotificationsContext({
            key: 'PeerRegisterNotification',
            payload: payload as unknown as PeerRegisterNotification,
          })
        );
        break;

      default:
        console.log('Unknown packet type', payload);
        break;
    }
  }
};

export default handleNotificationPacket;
