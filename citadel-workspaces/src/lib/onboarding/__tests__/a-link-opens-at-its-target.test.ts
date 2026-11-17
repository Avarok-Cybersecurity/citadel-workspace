/**
 * A native notice's click opens the account AT what it was about: a
 * conversation, a call, the requests list or the notification settings
 * (agent kernel/notices names it; the menu-bar app builds the link). The
 * target is an id or a fixed word, never content; anything else refuses the
 * link whole, as every other malformed link is refused.
 */
import { describe, it, expect } from 'vitest';
import { parseAccountLink } from '../account-link';
import { stashLinkTarget, takeLinkTarget } from '../link-target';

const parse = (query: string): ReturnType<typeof parseAccountLink> => parseAccountLink(new URLSearchParams(query));

describe('the link target', () => {
  it('reads a conversation, a call, the requests and the notification settings', () => {
    expect(parse('account=alice&open=conversation:12345')).toEqual({ username: 'alice', open: { kind: 'conversation', peerCid: 12345n } });
    expect(parse('account=alice&server=acme.work.avarok.net&open=call:18446744073709551615')).toEqual({
      username: 'alice', server: 'acme.work.avarok.net', open: { kind: 'call', peerCid: 18446744073709551615n },
    });
    expect(parse('account=alice&open=requests')).toEqual({ username: 'alice', open: { kind: 'requests' } });
    expect(parse('account=alice&open=settings:notifications')).toEqual({ username: 'alice', open: { kind: 'settings' } });
  });

  it('reads it through the scheme link too', () => {
    const link: string = encodeURIComponent('web+citadel://open?account=alice&open=conversation:7');
    expect(parse(`link=${link}`)).toEqual({ username: 'alice', open: { kind: 'conversation', peerCid: 7n } });
  });

  it('refuses the link whole for a target it does not know', () => {
    for (const open of [
      'conversation:', 'conversation:0', 'conversation:-1', 'conversation:18446744073709551616',
      'conversation:12 ', 'conversation:hello', 'message:hi there', 'settings', 'requests:1', '',
    ]) {
      expect(parse(`account=alice&open=${encodeURIComponent(open)}`), open).toBeNull();
    }
    expect(parse('account=alice&open=requests&open=requests')).toBeNull();
  });
});

describe('the stashed target', () => {
  it('is handed to the first consumer of its kind, once', () => {
    stashLinkTarget({ kind: 'requests' });
    expect(takeLinkTarget(['conversation', 'call'])).toBeNull();
    expect(takeLinkTarget(['requests'])).toEqual({ kind: 'requests' });
    expect(takeLinkTarget(['requests'])).toBeNull();
  });
});
