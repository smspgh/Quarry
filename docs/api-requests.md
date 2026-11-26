# API Requests

The **API Requests** panel sends an HTTP request and opens the response in a new tab, so you can format, browse, query and convert it with the [JSON tools](json.md) straight away. Open it from its icon on the left rail, below Macros, or with **View › Panels › API Requests**.

It is meant to stay small: one request at a time, with no collections, environments, variables, sign-in flows or cookie jar.

- [Sending a request](#sending-a-request)
- [Headers and secrets](#headers-and-secrets)
- [Saving requests](#saving-requests)
- [Where requests live](#where-requests-live)
- [Limits](#limits)

## Sending a request

1. Pick the method (GET, POST, PUT, PATCH, DELETE or OPTIONS) and type the URL. It must start with `http://` or `https://`.
2. Add headers if you need them (see below).
3. For POST, PUT and PATCH, type the body in the **Body** box. If the body is JSON and you have not set a `Content-Type` header, `Content-Type: application/json` is added for you.
4. Click **Send**, or press **Enter** in the URL box or **Ctrl+Enter** anywhere in the form. While the request runs, the button becomes **Cancel**.

The status line then shows the status code, the time taken and the size, for example `200 OK · 312 ms · 4.2 KB`. It's green for 2xx, amber for 3xx and red for errors.

The response body opens in a new unsaved tab named after the host and the last part of the path, for example `api.github.com-repos.json`. A JSON body is formatted with your **JSON indent** setting. Error responses (4xx, 5xx) open too, so you can read the error the server sent. A response with no body (204) opens nothing; a notification tells you so. A response larger than the large-file threshold opens in [large-file mode](large-files.md) instead.

The **JSON Tools** button (`{ }`) beside the status lights up once a request has opened a JSON response tab. Click it to bring that tab to the front and open the JSON Tools panel on it. It is dimmed before the first JSON response, after you close that tab, and when the last response was not JSON.

Compressed responses are unpacked.

### Redirects

Quarry follows up to 10 redirects itself, one at a time, and checks each one:

- **Never from https to plain http.** The request stops with a message instead, so nothing is sent unencrypted.
- **Secret headers stay with the site you typed.** If the server redirects to another site (another host or port) while any header is marked secret, Quarry stops and says so. `Authorization`, `Proxy-Authorization` and `Cookie` are never carried to another site, even when marked plain.
- **POST becomes GET where browsers do it.** A POST answered with 301 or 302, or any request answered with 303, continues as a GET without its body. 307 and 308 keep the method and the body.
- Only `http` and `https` addresses are followed.

## Headers and secrets

Each header row has a name and a value. Click **+** to add a row and **×** to remove one; rows with no name are not sent.

A header whose name looks like it carries a credential (`Authorization`, `Proxy-Authorization`, `Cookie`, `X-API-Key`, or any name containing *token*, *secret*, *password*, *auth* or *session*) is marked **secret**: its value is masked, and the eye button shows it. Click the lock to make any header secret or plain yourself.

Secret values are what Quarry encrypts when you save the request. The URL and the body are saved as typed, so put API keys in a secret header rather than in the URL's query string.

## Saving requests

Type a **Name** and, if you like, a **Description**, then click **Save**.

The **saved requests** dropdown at the top of the panel shows the request in the form. Click it to list **New request** and every saved request with its method, name and description:

- Click a request to load it into the form, ready to send.
- Click its **✎** (or press **F2**) to rename it in place, then **Enter** to keep the name or **Escape** to cancel. The contents stay as saved.
- Click its **🗑** (or press **Delete**) to move it to the Recycle Bin, after you confirm.

With the keyboard: **↓** or **Enter** on the dropdown opens it, **↑ ↓** move, **Enter** loads and **Escape** closes.

- A request with changes you have not saved shows **•** after its name in the dropdown. Switching to another request, or to **New request**, asks before discarding them.
- **Save as New** (shown once a saved request is open) writes the form as a new saved request and leaves the original as it was, which is handy for trying a variation of a call. If you kept the name, the copy gets a number: `Create item (2)`. The form then edits the new request.
- Changing the name and saving renames the file. Saving under the name of another saved request asks before replacing it.
- Nothing is written to disk until you click **Save**.

## Where requests live

Each saved request is a file `<name>.request.json` in `%APPDATA%\com.quarry.app\requests`, with the description, method, URL, headers and body.

Secret header values are encrypted with Windows' Data Protection API (DPAPI) for your Windows account. Only you, signed in to Windows on this PC, can decrypt them. Copying the file elsewhere is safe, but on another PC or account those values are empty and the panel asks you to type them again.

## Limits

- Requests are sent by Windows' own `curl.exe`, which checks certificates against the Windows certificate store. It does **not** use the Windows proxy setting: to send requests through a proxy, set the `HTTPS_PROXY` / `HTTP_PROXY` environment variables (and `NO_PROXY` for exceptions) before starting Quarry.
- Your own curl settings file (`.curlrc` / `_curlrc`) is ignored, so a setting in it can't switch off certificate checks for Quarry's requests.
- Characters such as `[ ]` and `{ }` in a URL are sent as typed (`?filter[name]=x` works).
- Response headers are not shown; only the status, the time taken and the size.
- Bodies are text. A binary response (an image, a zip file) opens as text, which is rarely useful.
- Response files of large-file size are kept in `%TEMP%\Quarry\api` and removed after a day. Use **Save As** to keep one.
