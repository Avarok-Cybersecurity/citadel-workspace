import React from 'react';
import WorkspaceAvatar from '../workspaceAvatar/WorkspaceAvatar';

const arr = [1, 2, 3, 4, 5, 6, 7];

function WorkspaceBar() {
  return (
    <div className="overflow-scroll h-screen w-16 bg-slate-500 pt-5 grid ">
      <div className="mx-auto flex flex-col gap-y-[20px] ">
        {arr.map((el, idx) => (
          <WorkspaceAvatar key={idx} />
        ))}
      </div>
    </div>
  );
}

export default WorkspaceBar;
