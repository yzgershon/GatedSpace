import { getHostId, getHostName } from "@superset/shared/host-info";
import { publicProcedure, router } from "..";

export const createDeviceRouter = () => {
	return router({
		getMachineId: publicProcedure.query((): { machineId: string } => {
			return { machineId: getHostId() };
		}),
		getHostInfo: publicProcedure.query(
			(): { machineId: string; hostName: string } => {
				return { machineId: getHostId(), hostName: getHostName() };
			},
		),
	});
};
