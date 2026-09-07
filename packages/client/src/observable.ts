export interface Observer<TData, TError> {
	next(value: TData): void;
	error(error: TError): void;
	complete(): void;
}

export type Teardown = () => void;

export interface Unsubscribable {
	unsubscribe: () => void;
}

export function observable<TData, TError>(
	cb: (observer: Observer<TData, TError>) => Teardown | void,
) {
	let isDone = false;

	return {
		subscribe(observer: Partial<Observer<TData, TError>>): Unsubscribable {
			let teardown: Teardown | void;

			// Returns whether the event should still be forwarded.
			const finish = () => {
				if (isDone) return false;
				isDone = true;
				teardown?.();
				return true;
			};

			teardown = cb({
				next: (value) => {
					if (isDone) return;
					observer.next?.(value);
				},
				error: (error) => {
					if (finish()) observer.error?.(error);
				},
				complete: () => {
					if (finish()) observer.complete?.();
				},
			});

			// `cb` may have completed synchronously, before `teardown` was assigned.
			if (isDone) teardown?.();

			return {
				unsubscribe() {
					if (isDone) return;
					isDone = true;
					teardown?.();
				},
			};
		},
		get done() {
			return isDone;
		},
	};
}

export type Observable<TData, TError> = ReturnType<
	typeof observable<TData, TError>
>;
