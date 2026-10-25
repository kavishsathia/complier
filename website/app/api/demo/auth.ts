// The demos call a paid model, so their routes answer only requests carrying
// the presenter's password.
export const authorised = (request: Request) =>
  !!process.env.DEMO_PASSWORD && request.headers.get("x-demo-password") === process.env.DEMO_PASSWORD;

export const denied = () => Response.json({ error: "Wrong password" }, { status: 401 });
