import { COMPANY } from "@superset/shared/constants";
import { Button } from "@superset/ui/button";
import { HiArrowLeft } from "react-icons/hi2";
import { LuCircleHelp } from "react-icons/lu";
import { electronTrpc } from "renderer/lib/electron-trpc";
import { isLocalOnlyBuild, setAuthMode } from "renderer/lib/local-mode";
import { PaginationDots } from "../PaginationDots";

interface OnboardingNavigationProps {
	currentStep: number;
	totalSteps: number;
	onBack: (() => void) | null;
	onContinue: (() => void) | null;
	continueDisabled?: boolean;
	continueLabel: string;
}

export function OnboardingNavigation({
	currentStep,
	totalSteps,
	onBack,
	onContinue,
	continueDisabled,
	continueLabel,
}: OnboardingNavigationProps) {
	const openUrl = electronTrpc.external.openUrl.useMutation();

	// In a local-only build, this whole flow only appears if the app was flipped
	// into cloud mode ("Sign in with an account"). Always give a way straight back
	// to local so a user can never get stranded here with no account to finish with.
	const backToLocal = () => {
		setAuthMode("local");
		window.location.reload();
	};

	return (
		<div className="mx-auto flex w-full max-w-[1200px] items-center px-12 pt-4 pb-8">
			<div className="flex flex-1 justify-start">
				<div className="flex w-[320px] items-center gap-2">
					{onBack && (
						<Button size="sm" variant="ghost" onClick={onBack}>
							<HiArrowLeft />
							Back
						</Button>
					)}
					{isLocalOnlyBuild() && (
						<Button size="sm" variant="ghost" onClick={backToLocal}>
							Use GatedSpace without an account
						</Button>
					)}
				</div>
			</div>
			<div className="flex flex-1 justify-center">
				<PaginationDots current={currentStep} total={totalSteps} />
			</div>
			<div className="flex flex-1 items-center justify-end gap-2">
				<Button
					size="sm"
					variant="ghost"
					onClick={() => openUrl.mutate(COMPANY.REPORT_ISSUE_URL)}
				>
					<LuCircleHelp />
					Get support
				</Button>
				{onContinue && (
					<Button
						size="sm"
						className="w-[160px]"
						onClick={onContinue}
						disabled={continueDisabled}
					>
						{continueLabel}
					</Button>
				)}
			</div>
		</div>
	);
}
