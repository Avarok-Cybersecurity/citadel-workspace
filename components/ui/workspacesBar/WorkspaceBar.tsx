import React, { Dispatch, SetStateAction } from 'react';

const arr = [1, 2, 7];

function WorkspaceBar({
  arrayOfItems,
  onOpen,
}: {
  arrayOfItems?: [any];
  onOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div
      id="workspace"
      className="overflow-scroll h-screen w-20 px-2 bg-gray-900 border-r-[1px] border-r-[#8aa29e] pt-5 grid "
    >
      <div className="mx-auto flex flex-col gap-y-[12px]">
        <span
          onClick={() => onOpen(true)}
          className="inline-flex h-12 w-12 items-center cursor-pointer justify-center rounded-full bg-[#8aa29e] text-center"
        >
          <span className="text-xl font-medium leading-none text-white">+</span>
        </span>
        {arr.map((el) => {
          return (
            <img
              className="inline-block h-12 w-12 rounded-full"
              src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80"
              alt=""
            />
          );
        })}
      </div>
    </div>
  );
}

export default WorkspaceBar;
