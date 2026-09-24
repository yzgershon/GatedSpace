import { services } from "@/server/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const handler = async (request: Request) => {
	try {
		const response = await services().auth.handler(request);
		response.headers.set("Cache-Control", "private, no-store");
		response.headers.set("Pragma", "no-cache");
		return response;
	} catch {
		return Response.json(
			{
				message:
					"Account sign-in is awaiting service setup. Try again once setup is complete.",
			},
			{ status: 503, headers: { "Cache-Control": "no-store" } },
		);
	}
};
export { handler as GET, handler as POST };
