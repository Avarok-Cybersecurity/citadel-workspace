export type ServiceTCPConnectionAccepted = {
  ServiceConnectionAccepted: {
    id: string;
  };
};

export type ServiceRegisterAccepted = {
  ServiceRegisterAccepted: {
    id: string;
    request_id: string;
  };
};

export type ServiceConnectionAccepted = {
  ServiceConnectionAccepted: {
    id: string;
    request_id: string;
  };
};

export type GetAllPeersSuccess = {};

export type ServiceDisconnect = {
  ServiceDisconnectAccepted: {
    uuid: string;
    request_id: string;
  };
};
