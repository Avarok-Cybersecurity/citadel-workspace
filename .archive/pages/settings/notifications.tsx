import { Layout } from '@components/common/Layout';
import Link from 'next/link';
import React from 'react';

const Notifications = () => {
  const secondaryNavigation = [
    { name: 'Account', href: '#', current: true },
    { name: 'Notifications', href: '#', current: false },
    { name: 'Billing', href: '#', current: false },
    { name: 'Teams', href: '#', current: false },
    { name: 'Integrations', href: '#', current: false },
  ];

  return (
    <div className="bg-gray-800">
      <header className="border-b border-white/5 bg-gray-800">
        {/* Secondary navigation */}
        <nav className="flex overflow-x-auto py-4">
          <ul
            role="list"
            className="flex min-w-full flex-none gap-x-6 px-4 text-sm font-semibold leading-6 text-gray-400 sm:px-6 lg:px-8"
          >
            {secondaryNavigation.map((item) => (
              <li key={item.name}>
                <Link
                  href={item.href}
                  className={item.current ? 'text-indigo-400' : ''}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <div>Start</div>
    </div>
  );
};

Notifications.Layout = Layout;

export default Notifications;
