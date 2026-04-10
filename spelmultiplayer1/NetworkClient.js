class NetworkClient {
    constructor(url) {
        this.ws = new WebSocket(url);
    }

    send(data) {
        if (this.ws.readyState !== WebSocket.OPEN) return;
        this.ws.send(JSON.stringify(data));
    }
}