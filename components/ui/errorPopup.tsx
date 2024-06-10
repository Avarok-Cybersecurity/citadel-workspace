import { ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/20/solid'

export default function ErrorPopup(props: {message: string, visible: boolean, setVisibility: (vis: boolean)=>void}) {
  return (
    <div className="rounded-md bg-red-50 p-4 fixed w-screen h-24 z-30 ease-in-out duration-300 cursor-default" id="error-popup" style={{bottom: (props.visible) ? "10px" : "-100px"}}>
      <div className="flex">
        <div className="flex-shrink-0">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
        </div>
        <div className="ml-3">
          <p className="text-sm font-medium text-red-800">{props.message}</p>
        </div>
        <div className="ml-auto pl-3">
          <div className="-mx-1.5 -my-1.5">
            <button
              type="button"
              className="inline-flex rounded-md bg-red-50 p-1.5 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 focus:ring-offset-red-50"
            >
              <span className="sr-only">Dismiss</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" onClick={()=>{props.setVisibility(false); console.log("set to false")}}/>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}