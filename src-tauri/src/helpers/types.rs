use futures::stream::SplitSink;
use tokio::{net::TcpStream, sync::Mutex};

pub(crate) type Sink = SplitSink<
    tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
    bytes::Bytes,
>;

pub(crate) type ConnSink = Mutex<
    Option<
        SplitSink<
            tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
            bytes::Bytes,
        >,
    >,
>;

pub(crate) type ConnStream = Mutex<
    Option<
        futures::stream::SplitStream<
            tokio_util::codec::Framed<TcpStream, tokio_util::codec::LengthDelimitedCodec>,
        >,
    >,
>;
