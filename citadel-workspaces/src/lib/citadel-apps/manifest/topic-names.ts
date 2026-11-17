/**
 * What a topic name is (p2p-demo-design §7): 1 to MAX_TOPIC_NAME_LEN of `[a-z0-9-]`. Shared by
 * the manifest rules and the topic port; pure, with no import but the ABI constants, so the
 * parent's catalogue script can load it.
 */
import { MAX_TOPIC_NAME_LEN } from '../sdk/generated/AbiConstants';

const NAME: RegExp = new RegExp(`^[a-z0-9-]{1,${MAX_TOPIC_NAME_LEN}}$`);

export const isTopicName = (name: string): boolean => NAME.test(name);
