import { useId } from "react";

/** Bundled feature illustrations stay sharp at every Windows display scale. */
export function ReleaseArtwork({ title }: { title: string }) {
	const id = useId().replaceAll(":", "");
	const mobile = /mobile|phone|photos|directing|themes|saved work/i.test(title);
	const browser = /browser|preview/i.test(title);
	const code = /code|model|effort/i.test(title);
	return (
		<div className="release-art">
			<svg
				viewBox="0 0 400 180"
				role="img"
				aria-label={`${title} — feature illustration`}
			>
				<defs>
					<radialGradient id={id}>
						<stop stopColor="#bd93f9" stopOpacity=".2" />
						<stop offset="1" stopColor="#bd93f9" stopOpacity="0" />
					</radialGradient>
				</defs>
				<rect width="400" height="180" fill="#1b1c28" />
				<ellipse cx="205" cy="85" rx="220" ry="150" fill={`url(#${id})`} />
				{mobile ? (
					[0, 1, 2].map((n) => (
						<g
							key={n}
							transform={`translate(${57 + n * 99},${n === 1 ? 13 : 30})`}
						>
							<rect
								width="88"
								height="170"
								rx="16"
								fill="#14151f"
								stroke={n === 1 ? "#bd93f9" : "#454357"}
							/>
							<rect x="33" y="7" width="22" height="3" rx="2" fill="#4b485e" />
							<circle cx="44" cy="27" r="8" fill="#bd93f9" />
							<path d="M42 23h4v6h-4z" fill="#282a36" />
							{[0, 1, 2].map((line) => (
								<g key={line}>
									<rect
										x={line % 2 ? 9 : 21}
										y={44 + line * 29}
										width="59"
										height="23"
										rx="8"
										fill={line % 2 ? "#2c2d3c" : "#594872"}
									/>
									<path
										d={`M${line % 2 ? 16 : 28} ${53 + line * 29}h36m-36 6h24`}
										stroke="#e1d9f0"
										strokeOpacity=".65"
										strokeWidth="2"
										strokeLinecap="round"
									/>
								</g>
							))}
							<rect
								x="9"
								y="137"
								width="70"
								height="20"
								rx="10"
								fill="#333241"
							/>
							<circle cx="68" cy="147" r="6" fill="#ff79c6" />
						</g>
					))
				) : (
					<>
						<rect
							x="28"
							y="25"
							width="344"
							height="174"
							rx="12"
							fill="#11121a"
							stroke="#555264"
						/>
						<rect
							x="138"
							y="33"
							width="130"
							height="20"
							rx="8"
							fill="#242432"
							stroke="#555264"
						/>
						{[0, 1, 2, 3].map((n) => (
							<circle
								key={n}
								cx={151 + n * 23}
								cy="43"
								r="4"
								fill={n === 2 ? "#de8663" : "#a69aff"}
							/>
						))}
						<rect x="38" y="64" width="64" height="115" rx="7" fill="#272834" />
						{[0, 1, 2, 3].map((n) => (
							<g key={n}>
								<circle
									cx="49"
									cy={78 + n * 24}
									r="4"
									fill={n === 1 ? "#de8663" : "#a69aff"}
								/>
								<path
									d={`M59 ${78 + n * 24}h28`}
									stroke="#797789"
									strokeWidth="3"
									strokeLinecap="round"
								/>
							</g>
						))}
						{[0, 1].map((n) => (
							<g key={n} transform={`translate(${112 + n * 125},64)`}>
								<rect
									width="115"
									height="115"
									rx="8"
									fill="#282a36"
									stroke={n ? "#575566" : "#8c95ff"}
								/>
								<circle
									cx="12"
									cy="13"
									r="4"
									fill={n ? "#de8663" : "#a69aff"}
								/>
								<path
									d="M23 13h48"
									stroke="#858293"
									strokeWidth="3"
									strokeLinecap="round"
								/>
								{browser && n ? (
									<>
										<rect
											x="8"
											y="27"
											width="99"
											height="17"
											rx="6"
											fill="#393848"
										/>
										<rect
											x="8"
											y="51"
											width="99"
											height="57"
											rx="4"
											fill="#1b1c27"
										/>
										<path
											d="M19 65h56m-56 9h75m-75 9h50"
											stroke="#a69aff"
											strokeWidth="3"
										/>
									</>
								) : (
									<>
										<rect
											x="24"
											y="29"
											width="82"
											height="21"
											rx="7"
											fill="#3c3c4b"
										/>
										{[0, 1, 2, 3].map((l) => (
											<path
												key={l}
												d={`M12 ${62 + l * 8}h${[83, 70, 88, 53][l]}`}
												stroke={code && l % 2 ? "#a5dcb4" : "#b6b3c6"}
												strokeOpacity=".8"
												strokeWidth="2"
												strokeLinecap="round"
											/>
										))}
										<rect
											x="8"
											y="101"
											width="99"
											height="24"
											rx="9"
											fill="#333544"
											stroke="#ff79c6"
											strokeOpacity={n ? 0 : 0.7}
										/>
									</>
								)}
							</g>
						))}
					</>
				)}
			</svg>
		</div>
	);
}
