import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { AppShell, MantineProvider } from "@mantine/core";
import { Example } from "./example";

const App = () => {
	return (
		<>
			<MantineProvider>
				<AppShell>
					<AppShell.Main>
						<Example />
					</AppShell.Main>
				</AppShell>
			</MantineProvider>
		</>
	);
};

export default App;
